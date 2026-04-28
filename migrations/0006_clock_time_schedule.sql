-- Migration 0006 — replace the morning/afternoon/evening time-block model
-- with a real clock-time schedule. Talia defines per-event working windows
-- (day + start/end time); seekers book specific trial slots inside those
-- windows. Trial-specific durations + buffers from migration 0005 drive the
-- "next available start time" computation.
--
-- The earlier event_slot_capacity table is dropped — no production data was
-- ever written to it (Phase 2 admin endpoints went through this rewrite
-- before going live).

DROP TABLE IF EXISTS event_slot_capacity;

-- Talia's working windows per event (when she is available to keep trials).
-- Multiple windows per event are allowed (e.g. GG day 1 morning + day 2 morning).
CREATE TABLE event_schedule_window (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  day_date   TEXT NOT NULL,                                              -- YYYY-MM-DD
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),  -- HH:MM
  end_time   TEXT NOT NULL CHECK (end_time   GLOB '[0-2][0-9]:[0-5][0-9]'),  -- HH:MM
  notes      TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX idx_window_event_day ON event_schedule_window(event_id, day_date);

-- Specific trial bookings on the timeline. A registration can have many
-- bookings (one per trial the seeker is attempting at that event).
-- start_at / end_at / buffer_until are full ISO datetimes (YYYY-MM-DDTHH:MM)
-- for unambiguous comparisons across day boundaries (Body III Burden spans days).
CREATE TABLE bookings (
  id              TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  seeker_id       TEXT NOT NULL REFERENCES seekers(id)       ON DELETE CASCADE,
  event_id        TEXT NOT NULL REFERENCES events(id),
  trial_code      TEXT NOT NULL REFERENCES trial_catalog(code),
  start_at        TEXT NOT NULL,                  -- 'YYYY-MM-DDTHH:MM'
  end_at          TEXT NOT NULL,                  -- start_at + duration_minutes
  buffer_until    TEXT NOT NULL,                  -- end_at + buffer_minutes
  notes           TEXT,
  created_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  voided_at       INTEGER,
  voided_by       TEXT,
  void_reason     TEXT
);
CREATE INDEX idx_booking_active ON bookings(event_id, start_at) WHERE voided_at IS NULL;
CREATE INDEX idx_booking_seeker ON bookings(seeker_id) WHERE voided_at IS NULL;
