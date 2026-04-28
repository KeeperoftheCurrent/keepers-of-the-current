// D1 query helpers used by every Pages Function.
// All queries go through prepared statements; never interpolate user input.

export interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  KEEPER_NOTIFY_EMAIL: string;
  EMAIL_FROM: string;
  SITE_URL: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
}

export async function queryAll<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  ...binds: unknown[]
): Promise<T[]> {
  const stmt = binds.length
    ? env.DB.prepare(sql).bind(...binds)
    : env.DB.prepare(sql);
  const { results } = await stmt.all<T>();
  return (results ?? []) as T[];
}

export async function queryFirst<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  ...binds: unknown[]
): Promise<T | null> {
  const stmt = binds.length
    ? env.DB.prepare(sql).bind(...binds)
    : env.DB.prepare(sql);
  return (await stmt.first<T>()) ?? null;
}

export async function exec(
  env: Env,
  sql: string,
  ...binds: unknown[]
): Promise<D1Result> {
  const stmt = binds.length
    ? env.DB.prepare(sql).bind(...binds)
    : env.DB.prepare(sql);
  return await stmt.run();
}
