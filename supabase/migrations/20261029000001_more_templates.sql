-- Six more case study templates (eleven in total), using four new layout variants implemented in code:
-- spotlight (results first), quote-led (the client's words first), editorial (a long-read look) and cards.
-- A template is data only: section types, a default theme and the NAME of a layout; nothing here is HTML.
--
-- Free: Clean Cards, Midnight. Pro: Results First, Testimonial First, Editorial, Agency Win.
-- Rollback (dev only): delete from public.templates where id::text like 'a0000000-0000-4000-8000-00000000000_' and id::text > 'a0000000-0000-4000-8000-000000000005';

insert into public.templates (id, name, category, tier, sections, default_theme, active) values
  ('a0000000-0000-4000-8000-000000000006', 'Clean Cards', 'general', 'free',
   '["challenge","solution","results","quote","cta"]',
   '{"layout":"cards","primary":"#0f766e","fontPair":"inter","radius":"lg","spacing":"comfortable","mode":"light"}', true),
  ('a0000000-0000-4000-8000-000000000007', 'Midnight', 'general', 'free',
   '["challenge","solution","results","quote","cta"]',
   '{"layout":"classic","primary":"#f59e0b","fontPair":"space-grotesk-inter","radius":"md","spacing":"comfortable","mode":"dark"}', true),
  ('a0000000-0000-4000-8000-000000000008', 'Results First', 'story', 'pro',
   '["results","challenge","solution","quote","cta"]',
   '{"layout":"spotlight","primary":"#dc2626","fontPair":"poppins-inter","radius":"lg","spacing":"comfortable","mode":"light"}', true),
  ('a0000000-0000-4000-8000-000000000009', 'Testimonial First', 'story', 'pro',
   '["quote","challenge","solution","results","cta"]',
   '{"layout":"quote-led","primary":"#7c3aed","fontPair":"lora-inter","radius":"xl","spacing":"spacious","mode":"light"}', true),
  ('a0000000-0000-4000-8000-00000000000a', 'Editorial', 'general', 'pro',
   '["challenge","trigger","solution","results","quote","cta"]',
   '{"layout":"editorial","primary":"#9f1239","fontPair":"playfair-source","radius":"none","spacing":"spacious","mode":"light"}', true),
  ('a0000000-0000-4000-8000-00000000000b', 'Agency Win', 'agency', 'pro',
   '["challenge","solution","results","quote","audience","cta"]',
   '{"layout":"spotlight","primary":"#1d4ed8","fontPair":"merriweather-opensans","radius":"md","spacing":"comfortable","mode":"light"}', true)
on conflict (id) do update
  set name = excluded.name, category = excluded.category, tier = excluded.tier,
      sections = excluded.sections, default_theme = excluded.default_theme, active = excluded.active;
