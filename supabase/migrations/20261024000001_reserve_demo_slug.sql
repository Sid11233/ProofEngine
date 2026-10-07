-- Public demos live at <workspace>.<sites domain>/demo/<slug>. A case study published at the slug "demo" would
-- share that first path segment, so "demo" and "demos" can no longer be claimed as a slug. Slugs already in use
-- are untouched (the check runs when a slug is chosen or published).
--
-- Rollback (dev only): recreate public.is_reserved_slug(text) from 20261004000001_identity.sql.

create or replace function public.is_reserved_slug(slug text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select slug = any (array[
    'www', 'app', 'api', 'admin', 'i', 'mail', 'support', 'billing', 'status', 'docs',
    'auth', 'login', 'logout', 'signup', 'dashboard', 'static', 'assets', 'cdn',
    'embed', 'demo', 'demos', 'pages', 'blog', 'help', 'smtp', 'ftp', 'dev', 'staging', 'test',
    'security', 'privacy', 'terms', 'root', 'null', 'undefined'
  ])
$$;
