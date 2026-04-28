-- Migration 0002 — seed the Hynafol 2026 event calendar.
-- May–Oct expeditions: dates TBD (NULL), to be filled in via admin endpoint
-- as the Hynafol calendar firms up. Grand Gathering Nov 8–15 is the trial debut.

INSERT INTO events (id, name, kind, starts_on, ends_on, active) VALUES
  ('expedition_may_2026', 'May Expedition 2026',       'expedition',      NULL,         NULL,         1),
  ('expedition_jun_2026', 'June Expedition 2026',      'expedition',      NULL,         NULL,         1),
  ('expedition_jul_2026', 'July Expedition 2026',      'expedition',      NULL,         NULL,         1),
  ('expedition_aug_2026', 'August Expedition 2026',    'expedition',      NULL,         NULL,         1),
  ('expedition_sep_2026', 'September Expedition 2026', 'expedition',      NULL,         NULL,         1),
  ('expedition_oct_2026', 'October Expedition 2026',   'expedition',      NULL,         NULL,         1),
  ('gg_2026',             'Grand Gathering 2026',      'grand_gathering', '2026-11-08', '2026-11-15', 1);
