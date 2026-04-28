-- Migration 0009 — catalog gg_only corrections and event ID cleanup.
--
-- Problems fixed:
--
-- 1. Soul T3 and Mind T3 were inserted with gg_only=0 (migration 0005/0003).
--    The canon and the seeker form both treat all Tier 3 trials as Grand
--    Gathering only. Align the DB.
--
-- 2. b_t3_course was seeded in migration 0003 but the Body III design was
--    reduced to Burden + Plank + Foot Race. Mark non-bookable (already 0)
--    and note it as retired so awards.ts never counts it as a requirement.
--    Cannot DELETE if any trial_events rows reference it, so we zero it out.
--
-- 3. Wrong-ID events potentially inserted by the admin panel seed button
--    ('grand_gathering_2026', 'a_courtly_night_2026', 'the_siege_2026',
--    'the_trials_2026'). The canonical IDs come from migration 0007.
--    ON DELETE CASCADE handles any orphaned registrations/bookings/windows.

-- ── 1. Fix gg_only on all Tier 3 trial codes ─────────────────────────────
UPDATE trial_catalog
   SET gg_only = 1
 WHERE tier = 3
   AND code IN (
     'b_t3_burden', 'b_t3_plank', 'b_t3_foot_race', 'b_t3_course',
     'm_t3',
     's_t3_testament', 's_t3_final_introduction'
   );

-- ── 2. Retire b_t3_course ────────────────────────────────────────────────
-- Zero out duration so it can never be booked; name updated for clarity.
UPDATE trial_catalog
   SET bookable         = 0,
       duration_minutes = NULL,
       name             = 'The Course (retired)',
       short_label      = 'III — The Course (retired)'
 WHERE code = 'b_t3_course';

-- ── 3. Delete wrong-ID events (cascade clears windows, registrations) ────
DELETE FROM events
 WHERE id IN (
   'grand_gathering_2026',
   'a_courtly_night_2026',
   'the_siege_2026',
   'the_trials_2026'
 );
