-- Changing a template or theme on an APPROVED case study failed with "We could not change the template": the update
-- policies let editors and admins read approved rows (USING) but their WITH CHECK only allowed the new row to be
-- draft, awaiting_client_approval or unpublished, so a change that left the status at "approved" was rejected.
--
-- "approved" is now allowed in WITH CHECK. This opens nothing: clients have no UPDATE privilege on the status or
-- slug columns (revoked in 20261009000001), so the policy cannot be used to set a status; it only stops rejecting
-- rows that already are approved. A template or theme change does not alter the signed content, so the signature
-- stays valid.
--
-- Rollback (dev only): recreate both policies with the previous WITH CHECK lists (without 'approved').

drop policy case_studies_update_editor on public.case_studies;
create policy case_studies_update_editor on public.case_studies
  for update to authenticated
  using (
    public.is_member(workspace_id, 'editor')
    and status in ('draft', 'awaiting_client_approval', 'approved', 'unpublished')
  )
  with check (
    public.is_member(workspace_id, 'editor')
    and status in ('draft', 'awaiting_client_approval', 'approved', 'unpublished')
  );
comment on policy case_studies_update_editor on public.case_studies is
  'Editor+ can edit case studies that are not published (including approved ones: template and theme). Status and slug are not updatable by clients (column privileges), so this cannot move a study to approved or published.';

drop policy case_studies_update_admin on public.case_studies;
create policy case_studies_update_admin on public.case_studies
  for update to authenticated
  using (public.is_member(workspace_id, 'admin'))
  with check (
    public.is_member(workspace_id, 'admin')
    and status in ('draft', 'awaiting_client_approval', 'approved', 'unpublished')
  );
comment on policy case_studies_update_admin on public.case_studies is
  'Admin+ can edit or take down a live case study (back to draft or unpublished) and change the template or theme of an approved one. Status and slug are not updatable by clients (column privileges).';
