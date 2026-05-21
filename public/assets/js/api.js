// Shared fetch wrapper. Returns { ok, status, body }.
// Body is parsed JSON when Content-Type is JSON, otherwise raw text.

export async function api(method, path, body = undefined) {
  const adminKey = sessionStorage.getItem('keeper_admin_key') || '';
  const init = {
    method,
    headers: {
      'Accept': 'application/json',
      ...(adminKey ? { 'Authorization': `Bearer ${adminKey}` } : {}),
    },
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
  const contentType = res.headers.get('Content-Type') || '';
  const isJson = contentType.includes('application/json');
  const parsed = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

  // Cloudflare Access auth redirect: fetch follows the 302 to the CF Access login page,
  // which returns 200 HTML instead of the JSON we expected. Detect and surface as 401.
  if (res.ok && !isJson && typeof parsed === 'string' && parsed.includes('cloudflareaccess')) {
    return { ok: false, status: 401, body: { error: 'Authentication required. Please open this page in your browser to log in.', authRequired: true } };
  }

  return { ok: res.ok, status: res.status, body: parsed };
}
