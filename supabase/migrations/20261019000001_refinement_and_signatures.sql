-- Text refinement log and e-signature records.
--
--   text_refinements    AI rewrite suggestions and whether they were accepted. Inserted by the server only.
--   consent_texts       The exact release wording, versioned. Changed only by migrations.
--   signing_challenges  One-time codes for signing. Service role only; no client access at all.
--   signatures          What a client signed. Insert-only. ip_hash / ua_hash are not readable by members.
--   signature_revocations, signature_events   Insert-only.
--
-- Rules enforced here, not in app code:
--   * a case study can be published only with a verified, web-consenting, unrevoked signature for its current version;
--   * social_posts can be inserted only while the current signature allows social use.
--
-- Deviation from the request: signature_revocations also carries workspace_id (composite FK), so it can use the
-- same append-only trigger and the same workspace-scoped policy as the other tables; signatures also checks that
-- esign_disclosure_accepted is true (a signature without it is meaningless).
--
-- Rollback (dev only): drop triggers case_studies_require_signature and social_posts_require_consent, drop their
-- functions, drop the six tables (signature_events, signature_revocations, signatures, signing_challenges,
-- consent_texts, text_refinements), delete from storage.buckets where id = 'signatures'.

-- ---------------------------------------------------------------------------
-- consent_texts
-- ---------------------------------------------------------------------------

create table public.consent_texts (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique check (char_length(version) between 1 and 40),
  kind          text not null default 'testimonial_release' check (char_length(kind) between 1 and 60),
  body          text not null check (char_length(body) between 1 and 20000),
  effective_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table public.consent_texts enable row level security;

create policy consent_texts_select_authenticated on public.consent_texts
  for select to authenticated
  using (true);
comment on policy consent_texts_select_authenticated on public.consent_texts is
  'Signed-in users can read the release wording. There is no insert, update or delete policy: wording changes only by migration.';

revoke all on public.consent_texts from anon, authenticated, service_role;
grant select on public.consent_texts to authenticated, service_role;

insert into public.consent_texts (version, kind, body)
values ('v1', 'testimonial_release',
  'LAWYER REVIEW REQUIRED. PLACEHOLDER TEXT, NOT LEGAL ADVICE. I agree that the business named on this page may publish the case study I reviewed, including the name I chose to show, on its website. I can ask for it to be taken down at any time.');

-- ---------------------------------------------------------------------------
-- text_refinements
-- ---------------------------------------------------------------------------

create table public.text_refinements (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  case_study_id   uuid not null,
  version         int not null check (version >= 1),
  field_path      text not null check (char_length(field_path) between 1 and 200),
  original_text   text not null check (char_length(original_text) <= 5000),
  suggested_text  text not null check (char_length(suggested_text) <= 5000),
  accepted        boolean not null default false,
  preset          text check (preset is null or char_length(preset) <= 60),
  model           text check (model is null or char_length(model) <= 100),
  input_tokens    int check (input_tokens is null or input_tokens >= 0),
  output_tokens   int check (output_tokens is null or output_tokens >= 0),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (case_study_id, workspace_id) references public.case_studies (id, workspace_id) on delete cascade
);

create index text_refinements_workspace_idx on public.text_refinements (workspace_id);
create index text_refinements_study_version_idx on public.text_refinements (case_study_id, version);

alter table public.text_refinements enable row level security;

create policy text_refinements_select_editor on public.text_refinements
  for select to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy text_refinements_select_editor on public.text_refinements is
  'Editors and above read their own workspace''s refinement log. Rows are inserted only by the server (service role).';

revoke all on public.text_refinements from anon, authenticated, service_role;
grant select on public.text_refinements to authenticated;
grant select, insert on public.text_refinements to service_role;
grant update (accepted) on public.text_refinements to service_role;

-- ---------------------------------------------------------------------------
-- signing_challenges (service role only)
-- ---------------------------------------------------------------------------

create table public.signing_challenges (
  id             uuid primary key default gen_random_uuid(),
  case_study_id  uuid not null references public.case_studies (id) on delete cascade,
  version        int not null check (version >= 1),
  code_hash      text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at     timestamptz not null,
  attempts       int not null default 0 check (attempts >= 0),
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index signing_challenges_study_version_idx on public.signing_challenges (case_study_id, version);

-- RLS on with no policy: signed-in users and anon can do nothing. The grants below are the service role's.
alter table public.signing_challenges enable row level security;

revoke all on public.signing_challenges from anon, authenticated, service_role;
grant select, insert, update on public.signing_challenges to service_role;

-- ---------------------------------------------------------------------------
-- signatures (insert-only)
-- ---------------------------------------------------------------------------

create table public.signatures (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete cascade,
  case_study_id             uuid not null,
  version                   int not null check (version >= 1),
  signer_name               text not null check (char_length(btrim(signer_name)) between 1 and 200),
  signer_email              text not null check (char_length(signer_email) between 3 and 320),
  signer_company            text check (signer_company is null or char_length(signer_company) <= 200),
  signer_role               text check (signer_role is null or char_length(signer_role) <= 200),
  display_name_choice       text not null check (display_name_choice in ('full', 'first_only', 'anonymous')),
  consent_text_version      text not null references public.consent_texts (version),
  esign_disclosure_accepted boolean not null check (esign_disclosure_accepted),
  consent_web               boolean not null,
  consent_social            boolean not null default false,
  consent_media             boolean not null default false,
  method                    text not null check (method in ('drawn', 'typed')),
  signature_path            text check (signature_path is null or char_length(signature_path) <= 300),
  content_hash              text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  otp_verified_at           timestamptz not null,
  signed_at                 timestamptz not null default now(),
  ip_hash                   text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  ua_hash                   text check (ua_hash is null or ua_hash ~ '^[0-9a-f]{64}$'),
  certificate_path          text check (certificate_path is null or char_length(certificate_path) <= 300),
  created_at                timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (case_study_id, workspace_id) references public.case_studies (id, workspace_id) on delete cascade,
  foreign key (case_study_id, version) references public.case_study_versions (case_study_id, version)
);

create index signatures_workspace_idx on public.signatures (workspace_id);
create index signatures_study_version_idx on public.signatures (case_study_id, version);

alter table public.signatures enable row level security;

create policy signatures_select_member on public.signatures
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy signatures_select_member on public.signatures is
  'Members read their own workspace''s signatures (the ip_hash and ua_hash columns are not granted). There is deliberately no insert, update or delete policy: rows are written by the server (service role) and never changed.';

revoke all on public.signatures from anon, authenticated, service_role;
grant select (id, workspace_id, case_study_id, version, signer_name, signer_email, signer_company, signer_role, display_name_choice,
              consent_text_version, esign_disclosure_accepted, consent_web, consent_social, consent_media, method, signature_path,
              content_hash, otp_verified_at, signed_at, certificate_path, created_at)
  on public.signatures to authenticated;
grant select, insert on public.signatures to service_role;

create trigger signatures_append_only
  before update or delete on public.signatures
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- signature_revocations (insert-only)
-- ---------------------------------------------------------------------------

create table public.signature_revocations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  signature_id  uuid not null,
  revoked_at    timestamptz not null default now(),
  reason        text check (reason is null or char_length(reason) <= 1000),
  method        text not null check (char_length(method) between 1 and 50),
  foreign key (signature_id, workspace_id) references public.signatures (id, workspace_id) on delete cascade
);

create index signature_revocations_workspace_idx on public.signature_revocations (workspace_id);
create index signature_revocations_signature_idx on public.signature_revocations (signature_id);

alter table public.signature_revocations enable row level security;

create policy signature_revocations_select_member on public.signature_revocations
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy signature_revocations_select_member on public.signature_revocations is
  'Members read their own workspace''s revocations. Rows are inserted only by the server (service role) and never changed.';

revoke all on public.signature_revocations from anon, authenticated, service_role;
grant select on public.signature_revocations to authenticated;
grant select, insert on public.signature_revocations to service_role;

create trigger signature_revocations_append_only
  before update or delete on public.signature_revocations
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- signature_events (insert-only)
-- ---------------------------------------------------------------------------

create table public.signature_events (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  case_study_id  uuid not null,
  signature_id   uuid,
  event          text not null check (event in ('sent', 'viewed', 'otp_sent', 'otp_verified', 'otp_failed', 'signed',
                                                'changes_requested', 'declined', 'certificate_generated', 'revoked')),
  ip_hash        text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  ua_hash        text check (ua_hash is null or ua_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  foreign key (case_study_id, workspace_id) references public.case_studies (id, workspace_id) on delete cascade,
  foreign key (signature_id, workspace_id) references public.signatures (id, workspace_id) on delete cascade
);

create index signature_events_workspace_idx on public.signature_events (workspace_id);
create index signature_events_study_idx on public.signature_events (case_study_id, created_at);

alter table public.signature_events enable row level security;

create policy signature_events_select_admin on public.signature_events
  for select to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy signature_events_select_admin on public.signature_events is
  'Admins and above read their own workspace''s signing trail (hash columns are not granted). Rows are inserted only by the server (service role) and never changed.';

revoke all on public.signature_events from anon, authenticated, service_role;
grant select (id, workspace_id, case_study_id, signature_id, event, created_at) on public.signature_events to authenticated;
grant select, insert on public.signature_events to service_role;

create trigger signature_events_append_only
  before update or delete on public.signature_events
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Publishing needs a valid signature
-- ---------------------------------------------------------------------------

create function public.require_signature_to_publish()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only the move INTO published is checked; going back to draft or unpublished is always allowed.
  if new.status = 'published' and old.status is distinct from 'published' then
    if not exists (
      select 1 from public.signatures s
      where s.case_study_id = new.id
        and s.version = new.current_version
        and s.otp_verified_at is not null
        and s.consent_web
        and not exists (select 1 from public.signature_revocations r where r.signature_id = s.id)
    ) then
      raise exception 'publish_blocked:not_signed';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.require_signature_to_publish() from public, anon, authenticated;

-- Named to run after case_studies_enforce_publish_rules (triggers fire in name order).
create trigger case_studies_require_signature
  before update on public.case_studies
  for each row execute function public.require_signature_to_publish();

-- ---------------------------------------------------------------------------
-- Social drafts need the signer's social consent
-- ---------------------------------------------------------------------------

create function public.require_social_consent_signature()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean;
begin
  -- The current signature is the latest unrevoked one for the study's current version.
  select s.consent_social into allowed
  from public.case_studies cs
  join public.signatures s on s.case_study_id = cs.id and s.version = cs.current_version
  where cs.id = new.case_study_id
    and not exists (select 1 from public.signature_revocations r where r.signature_id = s.id)
  order by s.signed_at desc
  limit 1;
  if allowed is distinct from true then
    raise exception 'social_blocked:no_consent' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function public.require_social_consent_signature() from public, anon, authenticated;

create trigger social_posts_require_consent
  before insert on public.social_posts
  for each row execute function public.require_social_consent_signature();

-- ---------------------------------------------------------------------------
-- Private storage bucket for signature images and certificates
-- ---------------------------------------------------------------------------
-- Not public. RLS on storage.objects with a RESTRICTIVE deny for this bucket: even a permissive policy added
-- later cannot open it to clients. Only the service role (which bypasses RLS) reads and writes, and hands out
-- short-lived signed URLs after its own checks. Skipped where the storage schema is not installed.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('signatures', 'signatures', false, 5242880, array['image/png', 'application/pdf'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    begin
      execute $p$
        create policy signatures_bucket_deny_clients on storage.objects
          as restrictive for all to anon, authenticated
          using (bucket_id <> 'signatures') with check (bucket_id <> 'signatures')
      $p$;
      execute $c$
        comment on policy signatures_bucket_deny_clients on storage.objects is
          'Denies every client (anon and signed-in) any access to the signatures bucket. Only the service role can read or write it.'
      $c$;
    exception when insufficient_privilege then
      raise notice 'could not create the storage policy (needs the storage admin); the bucket is still private with no permissive policy';
    end;
  end if;
end
$$;
