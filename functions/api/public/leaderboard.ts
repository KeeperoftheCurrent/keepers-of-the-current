// GET /api/public/leaderboard?event=plank|foot_race|course
// Sorted leaderboard for one Body III public-timed event.
// plank → DESC (longer is better). foot_race + course → ASC (faster is better).

import type { Env } from '../../lib/db';
import { queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';

const VALID = new Set(['plank', 'foot_race', 'course']);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const event_code = url.searchParams.get('event') || '';
  if (!VALID.has(event_code)) {
    return jsonResponse({ ok: false, error: 'event must be plank, foot_race, or course' }, 400);
  }

  const order = event_code === 'plank' ? 'DESC' : 'ASC';
  const entries = await queryAll<{
    rank: number;
    display_name: string;
    time_seconds: number;
    time_display: string;
    recorded_on: string;
  }>(
    env,
    `SELECT
        ROW_NUMBER() OVER (ORDER BY time_seconds ${order}) AS rank,
        display_name, time_seconds, time_display, recorded_on
       FROM leaderboard_times
      WHERE event_code = ?
      ORDER BY time_seconds ${order}`,
    event_code
  );

  return jsonResponse({ event: event_code, order, entries });
};
