-- Migration 0003 — seed the 12 canonical trial codes.
-- Pillars: body, mind, soul. Three tiers each. Body III is split into 4
-- sub-components per canon line 127: "Grand Gathering only. All four components required."
-- Body II is "The Form" per canon line 85 (NOT v1's "Unison Kata").
-- gg_only=1 only on the 4 Body III sub-codes.
-- witness_kind values reflect the canon's verification model:
--   'keeper'           = Keeper judges directly
--   'keeper_or_bearer' = Keeper or Bearer may witness
--   'beneficiary'      = the person being served attests (Soul T2)
--   'public_timed'     = public timekeeper / leaderboard (Body III timed events)

INSERT INTO trial_catalog (code, pillar, tier, name, short_label, witness_kind, gg_only, display_order) VALUES
  -- Body
  ('b_t1',          'body', 1, 'Awakening of Flesh',           'I — Awakening of Flesh',          'keeper_or_bearer', 0,  1),
  ('b_t2',          'body', 2, 'The Form',                     'II — The Form',                   'keeper',           0,  2),
  ('b_t3_burden',   'body', 3, 'The Burden',                   'III — The Burden',                'keeper_or_bearer', 1,  3),
  ('b_t3_plank',    'body', 3, 'The Plank',                    'III — The Plank',                 'public_timed',     1,  4),
  ('b_t3_foot_race','body', 3, 'The Foot Race',                'III — The Foot Race',             'public_timed',     1,  5),
  ('b_t3_course',   'body', 3, 'The Course',                   'III — The Course',                'public_timed',     1,  6),

  -- Mind
  ('m_t1',          'mind', 1, 'Awakening of Thought',         'I — Awakening of Thought',        'keeper',           0, 11),
  ('m_t2',          'mind', 2, 'Discipline of Thought',        'II — Discipline of Thought',      'keeper_or_bearer', 0, 12),
  ('m_t3',          'mind', 3, 'The Final Judgement',          'III — The Final Judgement',       'keeper',           0, 13),

  -- Soul
  ('s_t1',          'soul', 1, 'Awakening of Connection',      'I — Awakening of Connection',     'keeper',           0, 21),
  ('s_t2',          'soul', 2, 'Discipline of Connection',     'II — Discipline of Connection',   'beneficiary',      0, 22),
  ('s_t3',          'soul', 3, 'Testament & Final Introduction','III — Testament & Final Introduction', 'keeper',     0, 23);
