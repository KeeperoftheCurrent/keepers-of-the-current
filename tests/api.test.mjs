import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../public/assets/js/api.js', import.meta.url), 'utf8')).replace('export async function api', 'async function api');
function client(storage) {
  const calls = [];
  const context = { sessionStorage: storage, fetch: async (path, init) => {
    calls.push({ path, init });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }};
  runInNewContext(source, context);
  return { api: context.api, calls };
}

test('public registration requests work when browser tab storage is blocked', async () => {
  const { api, calls } = client({ getItem() { throw new DOMException('Storage is blocked', 'SecurityError'); } });
  for (const path of ['/api/public/events', '/api/seekers']) {
    const result = await api('POST', path, { action: 'test' });
    assert.equal(result.ok, true);
  }
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.init.headers.Authorization, undefined);
});

test('stored admin authorization remains attached when storage is available', async () => {
  const { api, calls } = client({ getItem: () => 'synthetic-test-key' });
  assert.equal((await api('GET', '/api/admin/overview')).ok, true);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-test-key');
});
