import { api } from './api.js';

const $ = (sel) => document.querySelector(sel);

function showToast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', kind === 'error');
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3200);
}

function renderErrors(errors) {
  const wrap = $('#errors');
  if (!errors || errors.length === 0) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML =
    '<div class="error-list"><strong>Could not record your name in the Trial Scroll:</strong><ul>' +
    errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('') +
    '</ul></div>';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadEvents() {
  const select = $('#event_id');
  const { ok, body } = await api('GET', '/api/public/events');
  if (!ok || !body || !Array.isArray(body.events)) {
    select.innerHTML = '<option value="">— could not load events —</option>';
    select.disabled = true;
    showToast('Could not load the Hynafol calendar. Try refreshing the page.', 'error');
    return;
  }
  const options = ['<option value="">— choose a gathering —</option>'];
  for (const ev of body.events) {
    const dates = ev.starts_on && ev.ends_on
      ? ` (${ev.starts_on} → ${ev.ends_on})`
      : ' (dates TBD)';
    const star = ev.kind === 'grand_gathering' ? ' ★' : '';
    options.push(
      `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.name)}${star}${escapeHtml(dates)}</option>`
    );
  }
  select.innerHTML = options.join('');
}

function bindRingCards() {
  document.querySelectorAll('.checkbox-row label').forEach((label) => {
    const input = label.querySelector('input[type="checkbox"]');
    const sync = () => label.classList.toggle('checked', input.checked);
    input.addEventListener('change', sync);
    sync();
  });
}

function showSuccess(name) {
  $('#form-wrap').hidden = true;
  $('#success').hidden = false;
  $('#success-name').textContent = name;
}

async function handleSubmit(e) {
  e.preventDefault();
  const submitBtn = $('#submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Marking the Scroll…';
  renderErrors(null);

  const form = e.target;
  const data = new FormData(form);
  const rings = data.getAll('rings_pursued');
  const payload = {
    name: (data.get('name') || '').toString().trim(),
    email: (data.get('email') || '').toString().trim(),
    house: (data.get('house') || '').toString().trim() || null,
    rings_pursued: rings,
    event_id: (data.get('event_id') || '').toString(),
    preferred_date: (data.get('preferred_date') || '').toString().trim() || null,
  };

  const { ok, status, body } = await api('POST', '/api/seekers', payload);

  if (ok && body && body.ok) {
    showSuccess(payload.name);
    return;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Mark me in the Scroll';

  if (status === 422 && body && Array.isArray(body.errors)) {
    renderErrors(body.errors);
    return;
  }
  const detail = (body && (body.error || body.detail)) || 'Unknown error';
  renderErrors([detail]);
}

document.addEventListener('DOMContentLoaded', () => {
  bindRingCards();
  loadEvents();
  $('#intake-form').addEventListener('submit', handleSubmit);
});
