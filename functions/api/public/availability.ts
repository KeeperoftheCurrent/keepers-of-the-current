// GET /api/public/availability?event_id=X&trial_codes=a,b,c
// For each requested bookable trial, returns the list of available start times
// inside Talia's windows that fit the trial's duration + buffer and don't
// overlap any active booking (also accounting for the existing bookings' buffers).
//
// Granularity: 15-minute increments. Available start_at times are returned as
// 'YYYY-MM-DDTHH:MM' strings.

import type { Env } from '../../lib/db';
import { queryFirst, queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';

interface CatalogRow {
  code: string;
  name: string;
  bookable: number;
  duration_minutes: number | null;
  buffer_minutes: number;
}

interface WindowRow {
  day_date: string;
  start_time: string;
  end_time: string;
}

interface BookingRow {
  start_at: string;
  buffer_until: string;
}

const STEP_MINUTES = 15;

function combine(date: string, hhmm: string): string {
  return `${date}T${hhmm}`;
}

function addMinutes(iso: string, minutes: number): string {
  // iso is YYYY-MM-DDTHH:MM. Use Date for arithmetic; treat as UTC to avoid TZ drift.
  const d = new Date(`${iso}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function timeStringsBetween(start: string, end: string): string[] {
  // Returns iso datetime strings at 15-minute steps from start (inclusive) up to
  // (but not necessarily including) end.
  const out: string[] = [];
  let cur = start;
  while (cur < end) {
    out.push(cur);
    cur = addMinutes(cur, STEP_MINUTES);
  }
  return out;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const event_id = url.searchParams.get('event_id');
  const codesParam = url.searchParams.get('trial_codes');
  if (!event_id) return jsonResponse({ ok: false, error: 'event_id query param is required' }, 400);

  const event = await queryFirst<{ id: string; active: number }>(
    env,
    `SELECT id, active FROM events WHERE id = ?`,
    event_id
  );
  if (!event || !event.active) return jsonResponse({ ok: false, error: 'Unknown or inactive event' }, 404);

  // Catalog: bookable trials only (optionally filtered by trial_codes)
  const requestedCodes = codesParam ? codesParam.split(',').map((s) => s.trim()).filter(Boolean) : null;
  let catalog: CatalogRow[];
  if (requestedCodes && requestedCodes.length) {
    const placeholders = requestedCodes.map(() => '?').join(',');
    catalog = await queryAll<CatalogRow>(
      env,
      `SELECT code, name, bookable, duration_minutes, buffer_minutes
         FROM trial_catalog
        WHERE code IN (${placeholders}) AND bookable = 1`,
      ...requestedCodes
    );
  } else {
    catalog = await queryAll<CatalogRow>(
      env,
      `SELECT code, name, bookable, duration_minutes, buffer_minutes
         FROM trial_catalog WHERE bookable = 1
         ORDER BY display_order`
    );
  }

  const windows = await queryAll<WindowRow>(
    env,
    `SELECT day_date, start_time, end_time FROM event_schedule_window
      WHERE event_id = ?
      ORDER BY day_date, start_time`,
    event_id
  );

  const bookings = await queryAll<BookingRow>(
    env,
    `SELECT start_at, buffer_until FROM bookings
      WHERE event_id = ? AND voided_at IS NULL`,
    event_id
  );

  // Compute available starts per trial
  const trials: Record<string, {
    name: string;
    duration_minutes: number;
    buffer_minutes: number;
    available_starts: string[];
  }> = {};

  for (const t of catalog) {
    if (!t.duration_minutes) continue;
    const dur = t.duration_minutes;
    const buf = t.buffer_minutes;
    const starts: string[] = [];

    for (const w of windows) {
      const winStart = combine(w.day_date, w.start_time);
      const winEnd = combine(w.day_date, w.end_time);
      const candidates = timeStringsBetween(winStart, winEnd);
      for (const candStart of candidates) {
        const candEnd = addMinutes(candStart, dur);
        const candBufferUntil = addMinutes(candEnd, buf);
        if (candBufferUntil > winEnd) continue;
        // No overlap with any existing booking [start_at, buffer_until)
        const conflict = bookings.some((b) => overlaps(candStart, candBufferUntil, b.start_at, b.buffer_until));
        if (conflict) continue;
        starts.push(candStart);
      }
    }

    trials[t.code] = {
      name: t.name,
      duration_minutes: dur,
      buffer_minutes: buf,
      available_starts: starts,
    };
  }

  return jsonResponse({ event_id, trials });
};
