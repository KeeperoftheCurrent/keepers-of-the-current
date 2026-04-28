// Shared fetch wrapper. Returns { ok, status, body }.
// Body is parsed JSON when Content-Type is JSON, otherwise raw text.

export async function api(method, path, body = undefined) {
  const init = {
    method,
    headers: { 'Accept': 'application/json' },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    return { ok: false, status: 0, body: { error: 'Network error', detail: String(err) } };
  }
  const isJson = (res.headers.get('Content-Type') || '').includes('application/json');
  const parsed = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body: parsed };
}
