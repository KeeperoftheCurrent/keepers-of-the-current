-- Migration 0001 — initial schema for Keepers of the Current v2.
-- Design principle: progress is event-sourced. The trial_events table IS the
-- "Trial Scroll" the canon describes — an append-only ledger of completion
-- events. Per-seeker state is derived via v_seeker_progress.

-- ─── seekers: identity row, email is the lookup key ───────────────────────
CREATE TABLE seekers (
  id               TEXT PRIMARY KEY,            -- ULID
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  email_normalized TEXT NOT NULL,               -- lower(trim(email))
  house            TEXT,
  rings_pursued    TEXT NOT NULL,               -- JSON array, e.g. '["body","mind"]'
  notes            TEXT,                        -- private Keeper note
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_seekers_email_norm ON seekers(email_normalized);
CREATE INDEX idx_seekers_name_lc    ON seekers(lower(name));

-- ─── events: Hynafol calendar, drives intake dropdown + Body III gating ───
CREATE TABLE events (
  id        TEXT PRIMARY KEY,                   -- 'gg_2026', 'expedition_may_2026'
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('expedition','grand_gathering')),
  starts_on TEXT,                               -- ISO date or NULL (TBD)
  ends_on   TEXT,
  active    INTEGER NOT NULL DEFAULT 1
);

-- ─── registrations: one row per intake submit ─────────────────────────────
CREATE TABLE registrations (
  id             TEXT PRIMARY KEY,
  seeker_id      TEXT NOT NULL REFERENCES seekers(id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL REFERENCES events(id),
  preferred_date TEXT,                          -- ISO date, optional
  rings_pursued  TEXT NOT NULL,                 -- JSON snapshot at intake
  email_status   TEXT NOT NULL DEFAULT 'pending'
                   CHECK (email_status IN ('pending','sent','failed')),
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_reg_seeker ON registrations(seeker_id);
CREATE INDEX idx_reg_event  ON registrations(event_id);

-- ─── trial_catalog: the 12 canonical trial codes ──────────────────────────
CREATE TABLE trial_catalog (
  code         TEXT PRIMARY KEY,                -- 'b_t1','b_t2','b_t3_burden',...
  pillar       TEXT NOT NULL CHECK (pillar IN ('body','mind','soul')),
  tier         INTEGER NOT NULL CHECK (tier IN (1,2,3)),
  name         TEXT NOT NULL,
  short_label  TEXT NOT NULL,
  witness_kind TEXT NOT NULL
                 CHECK (witness_kind IN ('keeper','keeper_or_bearer','beneficiary','public_timed')),
  gg_only      INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL
);

-- ─── trial_events: THE TRIAL SCROLL — append-only ledger ──────────────────
CREATE TABLE trial_events (
  id            TEXT PRIMARY KEY,
  seeker_id     TEXT NOT NULL REFERENCES seekers(id) ON DELETE CASCADE,
  trial_code    TEXT NOT NULL REFERENCES trial_catalog(code),
  event_id      TEXT REFERENCES events(id),
  completed_on  TEXT NOT NULL,                  -- ISO date (Keeper-supplied)
  witness       TEXT,
  note          TEXT,
  created_by    TEXT NOT NULL,                  -- Access JWT email
  created_at    INTEGER NOT NULL,
  voided_at     INTEGER,                        -- soft-delete
  voided_by     TEXT,
  void_reason   TEXT
);
CREATE INDEX idx_te_seeker ON trial_events(seeker_id);
CREATE INDEX idx_te_active ON trial_events(seeker_id, trial_code)
  WHERE voided_at IS NULL;

-- v_seeker_progress: derived 12-trial state, one row per (seeker × trial_code)
CREATE VIEW v_seeker_progress AS
SELECT
  s.id   AS seeker_id,
  tc.code AS trial_code,
  tc.pillar,
  tc.tier,
  CASE WHEN te.id IS NULL THEN 0 ELSE 1 END AS completed,
  te.id           AS trial_event_id,
  te.completed_on,
  te.witness,
  te.event_id     AS completed_at_event_id
FROM seekers s
CROSS JOIN trial_catalog tc
LEFT JOIN trial_events te
  ON te.seeker_id = s.id
 AND te.trial_code = tc.code
 AND te.voided_at IS NULL;

-- ─── awards: rings (auto), master title (auto), shield (manual) ───────────
CREATE TABLE awards (
  id             TEXT PRIMARY KEY,
  seeker_id      TEXT NOT NULL REFERENCES seekers(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL
                   CHECK (kind IN ('ring_body','ring_mind','ring_soul','master_title','shield')),
  awarded_on     TEXT NOT NULL,
  event_id       TEXT REFERENCES events(id),
  ceremony_note  TEXT,
  auto_conferred INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  revoked_at     INTEGER,
  revoked_by     TEXT,
  revoke_reason  TEXT,
  UNIQUE (seeker_id, kind)
);
CREATE INDEX idx_awards_seeker ON awards(seeker_id);
CREATE INDEX idx_awards_kind   ON awards(kind);

-- ─── leaderboard_times: Body III public-timed events ──────────────────────
CREATE TABLE leaderboard_times (
  id                TEXT PRIMARY KEY,
  event_code        TEXT NOT NULL
                      CHECK (event_code IN ('plank','foot_race','course')),
  seeker_id         TEXT REFERENCES seekers(id) ON DELETE SET NULL,
  display_name      TEXT NOT NULL,              -- denormalized for display / non-seeker entries
  time_seconds      REAL NOT NULL,              -- canonical numeric form
  time_display      TEXT NOT NULL,              -- '1:42' as entered, for display
  recorded_at_event TEXT REFERENCES events(id),
  recorded_on       TEXT NOT NULL,
  notes             TEXT,
  created_by        TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_lb_event ON leaderboard_times(event_code, time_seconds);

-- ─── admin_log: audit trail for every Keeper write ────────────────────────
CREATE TABLE admin_log (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,                    -- 'seeker.create'|'progress.mark'|'award.shield'|...
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT                              -- JSON
);
CREATE INDEX idx_log_ts ON admin_log(ts DESC);
