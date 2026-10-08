-- What a client tells us on the last screen of the interview, besides the interview itself:
-- a private rating and comment about working with the business, and optional contact details.
--
-- One row per interview, written only by the server after the interview is finished. Members read it;
-- nobody else, and no client of the API can write it. Contact details are personal data (covered by the export).
--
-- Rollback (dev only): drop table public.interview_closing;

create table public.interview_closing (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  interview_id   uuid not null,
  rating         smallint check (rating is null or rating between 1 and 5),
  comment        text check (comment is null or char_length(comment) <= 1000),
  contact_email  text check (contact_email is null or (char_length(contact_email) <= 320 and contact_email ~ '^[^@\s]+@[^@\s]+$')),
  contact_phone  text check (contact_phone is null or char_length(contact_phone) <= 40),
  company        text check (company is null or char_length(company) <= 200),
  job_title      text check (job_title is null or char_length(job_title) <= 120),
  created_at     timestamptz not null default now(),
  unique (interview_id),
  foreign key (interview_id, workspace_id) references public.interviews (id, workspace_id) on delete cascade
);
create index interview_closing_workspace_idx on public.interview_closing (workspace_id);

alter table public.interview_closing enable row level security;

create policy interview_closing_select_member on public.interview_closing
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy interview_closing_select_member on public.interview_closing is
  'Members read their own workspace''s closing feedback and contact details, and no other workspace''s. Rows are written only by the server.';

revoke all on public.interview_closing from anon, authenticated, service_role;
grant select on public.interview_closing to authenticated;
grant select, insert on public.interview_closing to service_role;
