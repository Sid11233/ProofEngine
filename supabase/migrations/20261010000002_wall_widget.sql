-- Phase 6.4: the "wall of proof" widget. A workspace can embed its published stories on its own
-- website in an iframe (<sub>.<domain>/embed). Which sites may frame it is an allowlist the admin
-- sets, enforced as the page's CSP frame-ancestors. Nothing is embeddable until an admin turns it on
-- and names at least one https origin.
--
-- Rollback (dev only): drop view public.public_wall_settings;
--   drop function public.save_wall_settings(uuid, boolean, text[], text, int);
--   drop table public.wall_settings;

create table public.wall_settings (
  workspace_id     uuid primary key references public.workspaces (id) on delete cascade,
  enabled          boolean not null default false,
  -- https origins only, no wildcards, no paths: https://example.com or https://example.com:8443
  allowed_origins  text[] not null default '{}'
                     check (cardinality(allowed_origins) <= 10),
  layout           text not null default 'grid' check (layout in ('grid', 'list')),
  max_items        int not null default 6 check (max_items between 1 and 24),
  updated_at       timestamptz not null default now(),
  check (not enabled or cardinality(allowed_origins) >= 1)
);

-- Every origin must look like https://host[:port]; checked per element by a trigger-free function.
create function public.valid_embed_origins(origins text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(o ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{2,5})?$' and char_length(o) <= 255), true)
  from unnest(origins) as o
$$;

alter table public.wall_settings add constraint wall_settings_origins_valid check (public.valid_embed_origins(allowed_origins));

alter table public.wall_settings enable row level security;

create policy wall_settings_select_admin on public.wall_settings
  for select to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy wall_settings_select_admin on public.wall_settings is
  'Admin+ can read their workspace''s widget settings. Writes only through save_wall_settings().';

revoke all on public.wall_settings from anon, authenticated;
grant select on public.wall_settings to authenticated;

create function public.save_wall_settings(ws uuid, is_enabled boolean, origins text[], chosen_layout text, item_limit int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  insert into public.wall_settings (workspace_id, enabled, allowed_origins, layout, max_items, updated_at)
  values (ws, is_enabled, coalesce(origins, '{}'), chosen_layout, item_limit, now())
  on conflict (workspace_id) do update
    set enabled = excluded.enabled, allowed_origins = excluded.allowed_origins,
        layout = excluded.layout, max_items = excluded.max_items, updated_at = now();
  perform public.audit(ws, 'wall.settings', ws::text);
end
$$;

revoke all on function public.save_wall_settings(uuid, boolean, text[], text, int) from public, anon;
grant execute on function public.save_wall_settings(uuid, boolean, text[], text, int) to authenticated;
revoke all on function public.valid_embed_origins(text[]) from public, anon, authenticated;

-- What the public embed page may know: only for workspaces that switched it on.
create view public.public_wall_settings
with (security_barrier = true)
as
select w.subdomain_slug as workspace_slug, s.allowed_origins, s.layout, s.max_items
from public.wall_settings s
join public.workspaces w on w.id = s.workspace_id
where s.enabled and w.subdomain_slug is not null;

comment on view public.public_wall_settings is
  'Anonymous read surface for the embed page: only enabled widgets, only what the page needs.';

revoke all on public.public_wall_settings from public, anon, authenticated;
grant select on public.public_wall_settings to anon, authenticated, service_role;
