-- Migration 0005 — trial duration/buffer metadata, catalog splits for the
-- two-path tiers (Mind T1, Soul T3), and pass/fail outcome on trial_events.
--
-- Adds the per-trial scheduling metadata that drives the admin schedule view
-- and the seeker-form availability lookup. Splits Mind T1 into Dilemma +
-- Recitation (two paths, either suffices for the tier) and Soul T3 into
-- Testament + Final Introduction (both required). Adds tier_aggregation so
-- awards.ts knows whether 'any' or 'all' sub-codes pass the tier.

-- New columns on trial_catalog
ALTER TABLE trial_catalog ADD COLUMN bookable                  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trial_catalog ADD COLUMN duration_minutes          INTEGER;
ALTER TABLE trial_catalog ADD COLUMN buffer_minutes            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trial_catalog ADD COLUMN max_per_seeker_per_event  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE trial_catalog ADD COLUMN lockout_kind              TEXT;
ALTER TABLE trial_catalog ADD COLUMN tier_aggregation          TEXT NOT NULL DEFAULT 'all'
  CHECK (tier_aggregation IN ('all','any'));

-- Body T2 — The Form: 30 min + 15 min buffer, bookable
UPDATE trial_catalog
   SET bookable = 1, duration_minutes = 30, buffer_minutes = 15
 WHERE code = 'b_t2';

-- Body T3 Burden — bookable handoff (15 min) + 15 min buffer + GG lockout
UPDATE trial_catalog
   SET bookable = 1, duration_minutes = 15, buffer_minutes = 15, lockout_kind = 'until_next_gg'
 WHERE code = 'b_t3_burden';

-- Body T3 timed events stay awareness-only but inherit the GG lockout
UPDATE trial_catalog
   SET lockout_kind = 'until_next_gg'
 WHERE code IN ('b_t3_plank','b_t3_foot_race','b_t3_course');

-- Mind T1 split — dilemma + recitation, either suffices for the tier
DELETE FROM trial_catalog WHERE code = 'm_t1';
INSERT INTO trial_catalog
  (code, pillar, tier, name, short_label, witness_kind, gg_only, display_order,
   bookable, duration_minutes, buffer_minutes, tier_aggregation) VALUES
  ('m_t1_dilemma',    'mind', 1, 'The Dilemma',    'I — The Dilemma',    'keeper', 0, 11, 1, 60, 30, 'any'),
  ('m_t1_recitation', 'mind', 1, 'The Recitation', 'I — The Recitation', 'keeper', 0, 12, 1, 30, 15, 'any');

-- Soul T3 split — testament + final introduction, both required for the tier
DELETE FROM trial_catalog WHERE code = 's_t3';
INSERT INTO trial_catalog
  (code, pillar, tier, name, short_label, witness_kind, gg_only, display_order,
   bookable, duration_minutes, buffer_minutes, tier_aggregation) VALUES
  ('s_t3_testament',          'soul', 3, 'The Testament',          'III — The Testament',          'keeper', 0, 31, 1, 60, 30, 'all'),
  ('s_t3_final_introduction', 'soul', 3, 'The Final Introduction', 'III — The Final Introduction', 'keeper', 0, 32, 1, 20, 15, 'all');

-- trial_events outcome — failure path required for one-attempt-per-registration enforcement
ALTER TABLE trial_events ADD COLUMN outcome TEXT NOT NULL DEFAULT 'passed'
  CHECK (outcome IN ('passed','failed'));
