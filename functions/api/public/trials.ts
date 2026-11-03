import type { Env } from '../../lib/db';
import { queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import { RETIRED_TRIAL_CODE } from '../../lib/catalog';
export const onRequestGet: PagesFunction<Env> = async ({ env }) => jsonResponse({ trials: await queryAll(env,
  'SELECT code, name, pillar, tier, bookable, duration_minutes, buffer_minutes, gg_only, tier_aggregation FROM trial_catalog WHERE code <> ? ORDER BY display_order', RETIRED_TRIAL_CODE) });
