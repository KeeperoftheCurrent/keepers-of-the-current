-- Migration 0007 — replace placeholder events with actual Hynafol 2026 calendar.
-- Source: https://hynafol.com/events (verified 2026-04-28)

-- Remove fake placeholder events that don't match the real calendar
DELETE FROM events WHERE id IN (
  'expedition_may_2026',
  'expedition_jun_2026',
  'expedition_jul_2026',
  'expedition_aug_2026',
  'expedition_sep_2026',
  'expedition_oct_2026'
);

-- Insert real 2026 Hynafol events
-- Past events omitted; only upcoming gatherings included
INSERT INTO events (id, name, kind, starts_on, ends_on, active) VALUES
  ('festival_of_champions_2026', 'Festival of Champions',  'expedition',      '2026-05-22', '2026-05-25', 1),
  ('courtly_night_2026',         'A Courtly Night',         'expedition',      '2026-09-12', '2026-09-12', 1),
  ('october_expedition_2026',    'October Expedition',      'expedition',      '2026-10-09', '2026-10-11', 1),
  ('gg_2026',                    'Grand Gathering 2026',    'grand_gathering', '2026-11-08', '2026-11-15', 1)
ON CONFLICT(id) DO UPDATE SET
  name     = excluded.name,
  kind     = excluded.kind,
  starts_on = excluded.starts_on,
  ends_on  = excluded.ends_on,
  active   = excluded.active;
