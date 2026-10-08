-- Voice answers. A client may speak an answer instead of typing it: the browser records it, the server sends it to a
-- speech-to-text provider, and the client reviews the written text before sending it as their answer. The recording
-- is kept for 30 days in a private bucket so the business can listen to it, then deleted.
--
--   interview_voice   one row per recording: who, where the file is, which consent text the client saw, when it expires,
--                     and which answer (interview_messages row) it belongs to once the client sends that answer.
--
-- Rows and files are written only by the server (service role). Members read the rows; the file is served by an
-- authenticated route that checks membership. Clients of the API cannot touch the bucket.
--
-- Rollback (dev only): drop table public.interview_voice; delete from storage.buckets where id = 'voice-notes';

create table public.interview_voice (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  interview_id         uuid not null,
  message_id           uuid references public.interview_messages (id) on delete set null,
  -- {workspace_id}/{interview_id}/{uuid}.{ext}
  file_path            text not null,
  mime_type            text not null check (mime_type in ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav')),
  size_bytes           int not null check (size_bytes between 1 and 5242880),
  consent_text_version text not null check (char_length(consent_text_version) between 1 and 50),
  transcript_chars     int check (transcript_chars is null or transcript_chars between 0 and 20000),
  expires_at           timestamptz not null default now() + interval '30 days',
  created_at           timestamptz not null default now(),
  check (file_path ~ ('^' || workspace_id::text || '/' || interview_id::text || '/[0-9a-f-]{36}\.(webm|ogg|m4a|wav)$')),
  foreign key (interview_id, workspace_id) references public.interviews (id, workspace_id) on delete cascade
);
create index interview_voice_workspace_idx on public.interview_voice (workspace_id);
create index interview_voice_interview_idx on public.interview_voice (interview_id);
create index interview_voice_expiry_idx on public.interview_voice (expires_at);

create function public.limit_interview_voice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.interview_voice v where v.interview_id = new.interview_id) >= 40 then
    raise exception 'Too many recordings for this interview' using errcode = '54000';
  end if;
  return new;
end
$$;
revoke all on function public.limit_interview_voice() from public, anon, authenticated;
create trigger interview_voice_limit before insert on public.interview_voice
  for each row execute function public.limit_interview_voice();

alter table public.interview_voice enable row level security;

create policy interview_voice_select_member on public.interview_voice
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy interview_voice_select_member on public.interview_voice is
  'Members read their own workspace''s voice recording rows, and no other workspace''s. Rows are written only by the server.';

revoke all on public.interview_voice from anon, authenticated, service_role;
grant select on public.interview_voice to authenticated;
grant select, insert, update, delete on public.interview_voice to service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('voice-notes', 'voice-notes', false, 5242880, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    begin
      execute $p$
        create policy voice_notes_bucket_deny_clients on storage.objects
          as restrictive for all to anon, authenticated
          using (bucket_id <> 'voice-notes') with check (bucket_id <> 'voice-notes')
      $p$;
      execute $c$
        comment on policy voice_notes_bucket_deny_clients on storage.objects is
          'Denies every client (anon and signed-in) any access to the voice-notes bucket. Only the service role can read or write it.'
      $c$;
    exception when insufficient_privilege then
      raise notice 'could not create the storage policy (needs the storage admin); the bucket is still private with no permissive policy';
    end;
  end if;
end
$$;
