-- "Refine with AI": plan limit counter, a per-field flag, and the one function that applies an accepted
-- refinement. The suggestion itself is never saved; only an accepted one is logged in text_refinements.
--
--   * usage_counters.ai_refinements: counted per workspace and month by reserve_refinement(), which also enforces
--     the plan limit (free 10, pro 300, team 2000: keep in step with src/lib/billing/plans.ts, a test checks it).
--   * case_studies.refined_fields: field paths whose text no longer matches the AI's/client's own wording. Changed
--     only by apply_text_refinement().
--   * apply_text_refinement(): editor+, not on a published page, the field must still hold the text the suggestion
--     was made for, only headline and section bodies (never a quote), at most one accepted refinement a minute per
--     case study. It writes a new version, logs the refinement and the audit entry.
--
-- Rollback (dev only): drop functions reserve_refinement(uuid), release_refinement(uuid),
--   apply_text_refinement(uuid, text, text, text, text, text, int, int); alter table public.case_studies drop column
--   refined_fields; alter table public.usage_counters drop column ai_refinements.

alter table public.usage_counters add column ai_refinements int not null default 0 check (ai_refinements >= 0);

alter table public.case_studies
  add column refined_fields text[] not null default '{}'
  check (cardinality(refined_fields) <= 60);

-- ---------------------------------------------------------------------------
-- reserve_refinement / release_refinement
-- ---------------------------------------------------------------------------

create function public.plan_refinement_limit(plan text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case plan when 'pro' then 300 when 'team' then 2000 else 10 end
$$;
revoke all on function public.plan_refinement_limit(text) from public, anon;
grant execute on function public.plan_refinement_limit(text) to authenticated;

-- True when the refinement was counted; false when the plan's monthly limit is already used.
create function public.reserve_refinement(ws uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap int;
  used int;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select public.plan_refinement_limit(w.plan) into cap from public.workspaces w where w.id = ws;

  insert into public.usage_counters as u (workspace_id, period, ai_refinements)
  values (ws, date_trunc('month', now())::date, 0)
  on conflict (workspace_id, period) do nothing;

  update public.usage_counters u set ai_refinements = u.ai_refinements + 1
  where u.workspace_id = ws and u.period = date_trunc('month', now())::date and u.ai_refinements < cap
  returning u.ai_refinements into used;
  return used is not null;
end
$$;
revoke all on function public.reserve_refinement(uuid) from public, anon;
grant execute on function public.reserve_refinement(uuid) to authenticated;

-- Gives the count back when the model failed or the suggestion did not pass the checks.
create function public.release_refinement(ws uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member(ws, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.usage_counters u set ai_refinements = greatest(u.ai_refinements - 1, 0)
  where u.workspace_id = ws and u.period = date_trunc('month', now())::date;
end
$$;
revoke all on function public.release_refinement(uuid) from public, anon;
grant execute on function public.release_refinement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_text_refinement
-- ---------------------------------------------------------------------------

-- `original` is what the field must contain right now (so a stale suggestion cannot overwrite newer edits).
-- `restoring` clears the field's flag instead of setting it.
create function public.apply_text_refinement(
  study uuid, path text, original text, new_text text, preset text, model text, in_tokens int, out_tokens int, restoring boolean default false
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.case_studies;
  keys text[];
  sec_index int;
  sec_type text;
  current_text text;
  next_version int;
  new_content jsonb;
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

  -- Only the headline and the body of a section that is not a quote.
  if path = 'headline' then
    keys := array['headline'];
    if char_length(btrim(coalesce(new_text, ''))) not between 1 and 120 then
      raise exception 'Invalid text' using errcode = '22023';
    end if;
  elsif path ~ '^sections\.[0-9]{1,2}\.body$' then
    sec_index := split_part(path, '.', 2)::int;
    sec_type := cs.content #>> array['sections', sec_index::text, 'type'];
    if sec_type is null or sec_type = 'quote' then
      raise exception 'That field cannot be refined' using errcode = '22023';
    end if;
    keys := array['sections', sec_index::text, 'body'];
    if char_length(btrim(coalesce(new_text, ''))) not between 1 and 2000 then
      raise exception 'Invalid text' using errcode = '22023';
    end if;
  else
    raise exception 'That field cannot be refined' using errcode = '22023';
  end if;

  current_text := cs.content #>> keys;
  if current_text is distinct from original then
    raise exception 'The text changed since the suggestion was made' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.text_refinements r
    where r.case_study_id = study and r.created_at > now() - interval '1 minute'
  ) then
    raise exception 'Too many changes at once' using errcode = '54000';
  end if;

  new_content := jsonb_set(cs.content, keys, to_jsonb(btrim(new_text)));
  next_version := cs.current_version + 1;

  update public.case_studies
    set content = new_content,
        current_version = next_version,
        status = 'draft',
        refined_fields = case
          when restoring then array_remove(refined_fields, path)
          when path = any (refined_fields) then refined_fields
          else array_append(refined_fields, path)
        end
    where id = study;

  insert into public.case_study_versions (case_study_id, workspace_id, version, content, created_by)
  values (study, cs.workspace_id, next_version, new_content, (select auth.uid()));

  insert into public.text_refinements
    (workspace_id, case_study_id, version, field_path, original_text, suggested_text, accepted, preset, model, input_tokens, output_tokens, created_by)
  values
    (cs.workspace_id, study, next_version, path, original, btrim(new_text), true,
     left(preset, 60), left(model, 100), greatest(in_tokens, 0), greatest(out_tokens, 0), (select auth.uid()));

  perform public.audit(cs.workspace_id, case when restoring then 'case_study.refine_restore' else 'case_study.refine' end, study::text);
  return next_version;
end
$$;
revoke all on function public.apply_text_refinement(uuid, text, text, text, text, text, int, int, boolean) from public, anon;
grant execute on function public.apply_text_refinement(uuid, text, text, text, text, text, int, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Field flags are by position ("sections.2.body"); when sections are added, removed or reordered the
-- positions no longer mean the same section, so the section flags are cleared (the headline flag stays).
-- ---------------------------------------------------------------------------

create function public.reset_refined_on_reorder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content
     and (jsonb_path_query_array(new.content, '$.sections[*].type') is distinct from jsonb_path_query_array(old.content, '$.sections[*].type')
          or jsonb_path_query_array(new.content, '$.sections[*].title') is distinct from jsonb_path_query_array(old.content, '$.sections[*].title'))
     and new.refined_fields is not distinct from old.refined_fields then
    new.refined_fields := array(select f from unnest(new.refined_fields) as f where f = 'headline');
  end if;
  return new;
end
$$;
revoke all on function public.reset_refined_on_reorder() from public, anon, authenticated;

create trigger case_studies_reset_refined
  before update on public.case_studies
  for each row execute function public.reset_refined_on_reorder();
