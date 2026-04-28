-- Migration 0008 — scrub remaining test seeker + add default working windows.
--
-- The test seeker collapsed all earlier debug submissions into one row via the
-- email-keyed upsert. Drop it (cascades to registrations + bookings).
--
-- Default windows are 09:00–17:00 on every day of every active event so the
-- seeker form's clock-time slot picker actually returns options. Talia can
-- adjust per-event from the admin Windows tab.

DELETE FROM seekers WHERE house = '(test row)';

INSERT INTO event_schedule_window (id, event_id, day_date, start_time, end_time, notes, created_at, created_by) VALUES
  -- Festival of Champions: May 22-25, 2026
  ('win_festival_2026_05_22', 'festival_of_champions_2026', '2026-05-22', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_festival_2026_05_23', 'festival_of_champions_2026', '2026-05-23', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_festival_2026_05_24', 'festival_of_champions_2026', '2026-05-24', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_festival_2026_05_25', 'festival_of_champions_2026', '2026-05-25', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),

  -- A Courtly Night: Sep 12, 2026
  ('win_courtly_2026_09_12', 'courtly_night_2026', '2026-09-12', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),

  -- October Expedition: Oct 9-11, 2026
  ('win_october_2026_10_09', 'october_expedition_2026', '2026-10-09', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_october_2026_10_10', 'october_expedition_2026', '2026-10-10', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_october_2026_10_11', 'october_expedition_2026', '2026-10-11', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),

  -- Grand Gathering: Nov 8-15, 2026
  ('win_gg_2026_11_08', 'gg_2026', '2026-11-08', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_gg_2026_11_09', 'gg_2026', '2026-11-09', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_gg_2026_11_10', 'gg_2026', '2026-11-10', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_gg_2026_11_11', 'gg_2026', '2026-11-11', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_gg_2026_11_12', 'gg_2026', '2026-11-12', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_gg_2026_11_13', 'gg_2026', '2026-11-13', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_gg_2026_11_14', 'gg_2026', '2026-11-14', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system'),
  ('win_gg_2026_11_15', 'gg_2026', '2026-11-15', '09:00', '17:00', 'Default 9–5; adjust in admin', strftime('%s','now'), 'system');
