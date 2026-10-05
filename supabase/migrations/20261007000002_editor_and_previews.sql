-- Phase 5.3-5.4: autosave, version snapshots, and client preview links.
--
--   * autosave_case_study: saves content as the owner types. It creates a new version row at
--     most once a minute for a draft (and always when the study was not a draft), so history
--     does not fill with keystrokes. The case study's content column is always current.
--   * snapshot_case_study: makes the stored versions catch up with the current content. The
--     client approval step (Phase 6) calls it first, so an approval is always tied to a
--     version whose stored content is exactly what the client was shown.
--   * case_study_previews: unlisted, expiring, revocable links that show one case study to a
--     client. Only a hash of each token is stored.
--
-- Rollback (dev only):
--   drop function if exists public.autosave_case_study(uuid, jsonb, uuid[]), public.snapshot_case_study(uuid),
--     public.create_preview_link(uuid, text), public.revoke_preview_link(uuid);
--   drop table if exists public.case_study_previews;

-- ---------------------------------------------------------------------------
-- autosave_case_study
-- ---------------------------------------------------------------------------

create function public.autosave_case_study(study uuid, new_content jsonb, edited_claims uuid[])
returns table (version int, versioned boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cs public.case_studies;
  last_version_at timestamptz;
  logo text;
  make_version boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into cs from public.case_studies where id = study for update;
  if cs.id is null or not public.is_member(cs.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if cs.status = 'published' then
    raise exception 'Unpublish before editing' using errcode = '22023';
  end if;
  if new_content is null or jsonb_typeof(new_content) <> 'object' or octet_length(new_content::text) > 200000 then
    raise exception 'Invalid content' using errcode = '22023';
  end if;

  -- A logo must be a file this workspace uploaded for case studies.
  logo := new_content #>> '{client,logoPath}';
  if logo is not null and logo !~ ('^' || cs.workspace_id::text || '/logos/[0-9a-f-]{36}\.webp$') then
    raise exception 'Invalid logo' using errcode = '22023';
  end if;

  -- Nothing changed: nothing to do.
  if cs.content = new_content then
    return query select cs.current_version, false;
    return;
  end if;

  select max(v.created_at) into last_version_at
  from public.case_study_versions v where v.case_study_id = study and v.version = cs.current_version;

  -- A study that was awaiting or had received approval always gets a new version, because the
  -- client may be looking at the old one. A draft coalesces edits made within a minute.
  make_version := cs.status <> 'draft' or last_version_at is null or last_version_at < now() - interval '1 minute';

  if make_version then
    update public.case_studies
      set content = new_content, current_version = cs.current_version + 1, status = 'draft'
      where id = study;
    insert into public.case_study_versions (case_study_id, workspace_id, version, content, created_by)
    values (study, cs.workspace_id, cs.current_version + 1, new_content, (select auth.uid()));
    perform public.audit(cs.workspace_id, 'case_study.edit', study::text);
  else
    update public.case_studies set content = new_content where id = study;
  end if;

  update public.claims
    set edited = (id = any (coalesce(edited_claims, '{}'))),
        client_confirmed = case when id = any (coalesce(edited_claims, '{}')) then false else client_confirmed end
    where case_study_id = study;

  return query select (select c.current_version from public.case_studies c where c.id = study), make_version;
end
$$;
revoke all on function public.autosave_case_study(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.autosave_case_study(uuid, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- snapshot_case_study
-- ---------------------------------------------------------------------------

create function public.snapshot_case_study(study uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cs public.case_studies;
  latest jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into cs from public.case_studies where id = study for update;
  if cs.id is null or not public.is_member(cs.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select v.content into latest from public.case_study_versions v
  where v.case_study_id = study and v.version = cs.current_version;

  if latest is distinct from cs.content then
    insert into public.case_study_versions (case_study_id, workspace_id, version, content, created_by)
    values (study, cs.workspace_id, cs.current_version + 1, cs.content, (select auth.uid()));
    update public.case_studies set current_version = cs.current_version + 1 where id = study;
    return cs.current_version + 1;
  end if;
  return cs.current_version;
end
$$;
revoke all on function public.snapshot_case_study(uuid) from public, anon;
grant execute on function public.snapshot_case_study(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- case_study_previews
-- ---------------------------------------------------------------------------

create table public.case_study_previews (
  id             uuid primary key default gen_random_uuid(),
  case_study_id  uuid not null,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  -- SHA-256 hex of the raw 32-byte token. The raw token is shown once and never stored.
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at     timestamptz not null default now() + interval '14 days',
  revoked_at     timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  check (expires_at <= created_at + interval '14 days'),
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade
);

create index case_study_previews_workspace_id_idx on public.case_study_previews (workspace_id);
create index case_study_previews_study_idx on public.case_study_previews (case_study_id);

alter table public.case_study_previews enable row level security;

create policy case_study_previews_select_editor on public.case_study_previews
  for select to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy case_study_previews_select_editor on public.case_study_previews is
  'Editor+ can list their workspace''s preview links (token_hash is not granted). Links are created and revoked only through create_preview_link() and revoke_preview_link().';

revoke all on public.case_study_previews from anon, authenticated;
grant select (id, case_study_id, workspace_id, expires_at, revoked_at, created_by, created_at)
  on public.case_study_previews to authenticated;

create function public.create_preview_link(study uuid, hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cs public.case_studies;
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into cs from public.case_studies where id = study;
  if cs.id is null or not public.is_member(cs.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  -- Previews are for work in progress; a published page has its own address.
  if cs.status = 'published' then
    raise exception 'Case study is published' using errcode = '22023';
  end if;
  if (select count(*) from public.case_study_previews p
      where p.case_study_id = study and p.revoked_at is null and p.expires_at > now()) >= 10 then
    raise exception 'Too many active preview links' using errcode = '54000';
  end if;

  insert into public.case_study_previews (case_study_id, workspace_id, token_hash, created_by)
  values (study, cs.workspace_id, hash, (select auth.uid()))
  returning id into new_id;
  perform public.audit(cs.workspace_id, 'preview.create', study::text);
  return new_id;
end
$$;

create function public.revoke_preview_link(preview uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.case_study_previews;
begin
  select * into p from public.case_study_previews where id = preview;
  if p.id is null or not public.is_member(p.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.case_study_previews set revoked_at = coalesce(revoked_at, now()) where id = preview;
  perform public.audit(p.workspace_id, 'preview.revoke', p.case_study_id::text);
end
$$;

revoke all on function public.create_preview_link(uuid, text) from public, anon;
revoke all on function public.revoke_preview_link(uuid) from public, anon;
grant execute on function public.create_preview_link(uuid, text) to authenticated;
grant execute on function public.revoke_preview_link(uuid) to authenticated;
