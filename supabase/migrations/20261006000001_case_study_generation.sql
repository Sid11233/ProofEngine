-- Phase 4: case study generation and review.
--
--   * claims.edited: set when the owner changes a number or quote so it no longer matches
--     what the client said. Edited claims lose client_confirmed and need re-approval.
--   * case_studies.generation_issues: what the generator removed or could not verify.
--   * bump_ai_usage: lets an editor's generation count against the workspace's AI usage.
--   * save_case_study_edit: the only way to change a case study's content after creation.
--     It makes the next version, returns the case study to draft and updates the edited
--     flags in one transaction, so a client cannot skip versioning or confirm a claim.
--
-- Rollback (dev only):
--   drop function if exists public.save_case_study_edit(uuid, jsonb, uuid[]), public.bump_ai_usage(uuid, int),
--     public.create_generated_case_study(uuid, uuid, jsonb, jsonb, jsonb);
--   alter table public.claims drop column edited;
--   alter table public.case_studies drop column generation_issues;

alter table public.claims add column edited boolean not null default false;

alter table public.case_studies
  add column generation_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(generation_issues) = 'array' and octet_length(generation_issues::text) <= 20000);
grant insert (generation_issues) on public.case_studies to authenticated;

-- Direct content updates are replaced by save_case_study_edit(), which versions them.
revoke update (content, status, current_version) on public.case_studies from authenticated;
-- Status changes that are not edits (request approval, unpublish) keep working.
grant update (status) on public.case_studies to authenticated;

-- ---------------------------------------------------------------------------
-- bump_ai_usage
-- ---------------------------------------------------------------------------

create function public.bump_ai_usage(ws uuid, amount int default 1)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_member(ws, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if amount is null or amount < 1 or amount > 10 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;
  insert into public.usage_counters as u (workspace_id, period, ai_messages)
  values (ws, date_trunc('month', now())::date, amount)
  on conflict (workspace_id, period) do update set ai_messages = u.ai_messages + amount;
end
$$;
revoke all on function public.bump_ai_usage(uuid, int) from public, anon;
grant execute on function public.bump_ai_usage(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- save_case_study_edit
-- ---------------------------------------------------------------------------

-- `edited_claims` lists the claims whose number or quote no longer matches the client's
-- words (worked out by the server from the new content). Every claim of this case study is
-- recomputed from it, so reverting an edit clears the flag. Edited claims lose any client
-- confirmation. Only 'draft', 'awaiting_client_approval', 'approved' and 'unpublished'
-- studies can be edited this way; editing a live page is an admin action that arrives with
-- the publish trigger in Phase 6.
create function public.save_case_study_edit(study uuid, new_content jsonb, edited_claims uuid[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cs public.case_studies;
  next_version int;
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

  next_version := cs.current_version + 1;

  update public.case_studies
    set content = new_content, current_version = next_version, status = 'draft'
    where id = study;

  insert into public.case_study_versions (case_study_id, workspace_id, version, content, created_by)
  values (study, cs.workspace_id, next_version, new_content, (select auth.uid()));

  update public.claims
    set edited = (id = any (coalesce(edited_claims, '{}'))),
        client_confirmed = case when id = any (coalesce(edited_claims, '{}')) then false else client_confirmed end
    where case_study_id = study;

  perform public.audit(cs.workspace_id, 'case_study.edit', study::text);
  return next_version;
end
$$;
revoke all on function public.save_case_study_edit(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.save_case_study_edit(uuid, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- create_generated_case_study: saves a generated draft atomically
-- ---------------------------------------------------------------------------

-- The app builds the content (with real claim ids already in it) and the claim rows; this
-- stores the case study, its claims and version 1 together or not at all. Claim rows still
-- pass through the trigger that demands a verbatim client quote. Claims are always saved
-- unconfirmed: only the client's approval (Phase 6) can confirm them.
create function public.create_generated_case_study(
  ws uuid, intr uuid, new_content jsonb, issues jsonb, claim_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.interviews;
  new_id uuid;
  c jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select * into i from public.interviews where id = intr and workspace_id = ws for update;
  if i.id is null then
    raise exception 'Interview not found' using errcode = 'P0002';
  end if;
  -- The client must have finished and consented before anything is written about them.
  if i.status <> 'completed' or i.consent_given is not true then
    raise exception 'Interview is not complete or consent was not given' using errcode = '22023';
  end if;
  if exists (select 1 from public.case_studies cs where cs.interview_id = intr and cs.workspace_id = ws) then
    raise exception 'A case study already exists for this interview' using errcode = '23505';
  end if;

  if jsonb_typeof(new_content) <> 'object' or octet_length(new_content::text) > 200000
     or jsonb_typeof(claim_rows) <> 'array' or jsonb_array_length(claim_rows) > 60
     or jsonb_typeof(coalesce(issues, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid input' using errcode = '22023';
  end if;

  insert into public.case_studies (workspace_id, interview_id, content, generation_issues, status, current_version)
  values (ws, intr, new_content, coalesce(issues, '[]'::jsonb), 'draft', 1)
  returning id into new_id;

  for c in select * from jsonb_array_elements(claim_rows) loop
    insert into public.claims (id, case_study_id, workspace_id, text, source_message_id, source_quote, client_confirmed)
    values ((c ->> 'id')::uuid, new_id, ws, c ->> 'text', (c ->> 'source_message_id')::uuid, c ->> 'source_quote', false);
  end loop;

  insert into public.case_study_versions (case_study_id, workspace_id, version, content, created_by)
  values (new_id, ws, 1, new_content, (select auth.uid()));

  perform public.audit(ws, 'case_study.generate', new_id::text);
  return new_id;
end
$$;
revoke all on function public.create_generated_case_study(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_generated_case_study(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
