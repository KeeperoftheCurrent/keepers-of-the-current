// GET /api/public/events
// Returns the active Hynafol calendar for the intake form dropdown.
// Public — no auth.

import type { Env } from '../../lib/db';
import { queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';

interface EventRow {
  id: string;
  name: string;
  kind: 'expedition' | 'grand_gathering';
  starts_on: string | null;
  ends_on: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const events = await queryAll<EventRow>(
    env,
    `SELECT id, name, kind, starts_on, ends_on
       FROM events
      WHERE active = 1
      ORDER BY
        CASE kind WHEN 'expedition' THEN 0 ELSE 1 END,
        COALESCE(starts_on, '9999-99-99'),
        name`
  );
  return jsonResponse({ events });
};
