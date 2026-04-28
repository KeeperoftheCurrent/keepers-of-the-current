-- Migration 0004 — slot booking capacity + soft-delete on registrations.
-- The capacity table is the gate that keeps the seeker form's preferred-time
-- dropdown honest (full slots disappear). Missing row = unlimited; capacity=0
-- means the time block is closed for that event.

CREATE TABLE event_slot_capacity (
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  time_block TEXT NOT NULL CHECK (time_block IN ('morning','afternoon','evening')),
  capacity   INTEGER NOT NULL CHECK (capacity >= 0),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (event_id, time_block)
);

-- Soft-delete columns on registrations so a voided registration frees its slot.
ALTER TABLE registrations ADD COLUMN voided_at   INTEGER;
ALTER TABLE registrations ADD COLUMN voided_by   TEXT;
ALTER TABLE registrations ADD COLUMN void_reason TEXT;
