// Top-level middleware: catches unhandled errors and returns JSON, sets a few
// shared headers. Applies to every /api/* request.

import type { Env } from './lib/db';

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    const res = await context.next();
    // Mirror security-friendly defaults.
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'no-referrer');
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[unhandled]', err);
    return jsonResponse({ ok: false, error: 'Internal error', detail: message }, 500);
  }
};

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
