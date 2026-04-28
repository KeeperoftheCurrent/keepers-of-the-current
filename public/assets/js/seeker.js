import { api } from './api.js';

const $ = (sel) => document.querySelector(sel);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Bookable trial catalog (mirrors trial_catalog rows where bookable=1).
// Hardcoded so the form can render trials grouped by pillar without an extra API call.
const BOOKABLE_TRIALS = [
  { code: 'b_t2',                     pillar: 'body', short: 'Body II',  name: 'The Form',                  duration: 30, buffer: 15, gg_only: false, note: 'Witness only — seekers learn the kata from a video beforehand.' },
  { code: 'b_t3_burden',              pillar: 'body', short: 'Body III', name: 'The Burden',                duration: 15, buffer: 15, gg_only: true,  note: 'A 24-hour vigil starting at the booked time. Grand Gathering only.' },
  { code: 'm_t1_dilemma',             pillar: 'mind', short: 'Mind I',   name: 'The Dilemma',               duration: 60, buffer: 30, gg_only: false, note: '60-minute philosophical dilemma with the Keeper.' },
  { code: 'm_t1_recitation',          pillar: 'mind', short: 'Mind I',   name: 'The Recitation',            duration: 30, buffer: 15, gg_only: false, note: 'Memorise and deliver a passage of your choosing.' },
  { code: 's_t3_testament',           pillar: 'soul', short: 'Soul III', name: 'The Testament',             duration: 60, buffer: 30, gg_only: false, note: 'A private reckoning with the Keeper, conducted as a Tea Ceremony.' },
  { code: 's_t3_final_introduction',  pillar: 'soul', short: 'Soul III', name: 'The Final Introduction',    duration: 20, buffer: 15, gg_only: false, note: 'Includes the Gift of the Coin.' },
];

function showToast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast visible' + (kind === 'error' ? ' error' : '');
  setTimeout(() => (t.className = 'toast'), 3200);
}

function renderErrors(errors) {
  const wrap = $('#errors');
  if (!errors || errors.length === 0) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;
  wrap.innerHTML =
    '<div class="error-list"><strong>Could not record your name:</strong><ul>' +
    errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('') +
    '</ul></div>';
}

function fmtEventDates(starts, ends) {
  if (!starts) return 'dates TBD';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [sy, sm, sd] = starts.split('-').map(Number);
  // Single-day or missing/matching end date
  if (!ends || ends === starts) return `${MONTHS[sm - 1]} ${sd}, ${sy}`;
  const [ey, em, ed] = ends.split('-').map(Number);
  if (sm === em && sy === ey) {
    // Same month: "May 22–25, 2026"
    return `${MONTHS[sm - 1]} ${sd}–${ed}, ${sy}`;
  }
  // Different months (same year assumed): "Nov 8 – Dec 1, 2026"
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
}

async function loadEvents() {
  const select = $('#event_id');
  const { ok, body } = await api('GET', '/api/public/events');
  if (!ok || !body || !Array.isArray(body.events)) {
    select.innerHTML = '<option value="">— could not load events —</option>';
    select.disabled = true;
    showToast('Could not load the Hynafol calendar.', 'error');
    return;
  }
  const options = ['<option value="">— choose a gathering —</option>'];
  for (const ev of body.events) {
    const dates = ` (${fmtEventDates(ev.starts_on, ev.ends_on)})`;
    const star = ev.kind === 'grand_gathering' ? ' ★' : '';
    options.push(`<option value="${escapeHtml(ev.id)}" data-kind="${escapeHtml(ev.kind)}">${escapeHtml(ev.name)}${star}${escapeHtml(dates)}</option>`);
  }
  select.innerHTML = options.join('');
  select.addEventListener('change', onEventChange);
}

function bindRingCards() {
  document.querySelectorAll('.checkbox-row label').forEach((label) => {
    const input = label.querySelector('input[type="checkbox"]');
    const sync = () => label.classList.toggle('checked', input.checked);
    input.addEventListener('change', sync);
    sync();
  });
}

let currentAvailability = null; // {[trial_code]: {available_starts: [...]}}

function fmtSlot(iso) {
  // iso is YYYY-MM-DDTHH:MM. Display as e.g. "Sun Nov 8 — 9:00 AM"
  const [date, time] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const day = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const hour12 = ((hh + 11) % 12) + 1;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  return `${day} — ${hour12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

async function onEventChange() {
  const select = $('#event_id');
  const eventId = select.value;
  const eventOption = select.options[select.selectedIndex];
  const isGG = eventOption?.dataset.kind === 'grand_gathering';
  const trialsSection = $('#trials-section');

  if (!eventId) {
    trialsSection.hidden = true;
    currentAvailability = null;
    return;
  }

  // Fetch availability for all bookable trials at this event
  const codes = BOOKABLE_TRIALS.map((t) => t.code).join(',');
  const { ok, body } = await api('GET', `/api/public/availability?event_id=${encodeURIComponent(eventId)}&trial_codes=${codes}`);
  if (!ok) {
    trialsSection.hidden = true;
    currentAvailability = null;
    return;
  }
  currentAvailability = body.trials || {};
  renderTrialList(isGG);
  trialsSection.hidden = false;
}

function renderTrialList(isGG) {
  const list = $('#trials-list');
  const PILLARS = [
    { key: 'body', label: 'Body — the Ring of Endurance' },
    { key: 'mind', label: 'Mind — the Ring of Focus' },
    { key: 'soul', label: 'Soul — the Ring of Connection' },
  ];

  list.innerHTML = PILLARS.map((p) => {
    const trials = BOOKABLE_TRIALS.filter((t) => t.pillar === p.key);
    const trialsHtml = trials.map((t) => {
      // GG-only trials at non-GG events are hidden
      if (t.gg_only && !isGG) return '';
      const slots = currentAvailability?.[t.code]?.available_starts || [];
      const isFull = slots.length === 0;
      const slotOptions = slots.map((s) => `<option value="${s}">${fmtSlot(s)}</option>`).join('');
      const totalDuration = t.code === 'b_t3_burden' ? '~24 hours' : `${t.duration} min`;
      return `<div class="trial-row" data-code="${t.code}">
        <label class="head">
          <input type="checkbox" data-code="${t.code}" ${isFull ? 'disabled' : ''}>
          <div>
            <div class="trial-name">${escapeHtml(t.short)} — ${escapeHtml(t.name)}</div>
            <div class="trial-meta">${totalDuration}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
          </div>
        </label>
        <div class="slot-picker">
          <span class="label-text">Choose a time</span>
          <select data-slot-for="${t.code}" required>
            <option value="">— choose a time —</option>
            ${slotOptions}
          </select>
        </div>
        ${isFull ? `<div class="full-msg">All slots for this trial are booked at this gathering.</div>` : ''}
      </div>`;
    }).filter(Boolean).join('');
    if (!trialsHtml) return '';
    return `<div class="pillar-group"><h4>${p.label}</h4>${trialsHtml}</div>`;
  }).join('');

  // Bind checkbox toggles
  list.querySelectorAll('.trial-row input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const row = cb.closest('.trial-row');
      row.classList.toggle('selected', cb.checked);
    });
  });
}

function showSuccess(name, bookings) {
  $('#form-wrap').hidden = true;
  $('#success').hidden = false;
  $('#success-name').textContent = name;
  if (bookings && bookings.length > 0) {
    const lines = bookings.map((b) => {
      const trial = BOOKABLE_TRIALS.find((t) => t.code === b.trial_code);
      return `<li><strong>${escapeHtml(trial?.name || b.trial_code)}</strong> · ${escapeHtml(fmtSlot(b.start_at))}</li>`;
    }).join('');
    $('#success-bookings').innerHTML = `<p>Your booked trial(s):</p><ul style="text-align:left;display:inline-block;margin:0 auto;">${lines}</ul>`;
  } else {
    $('#success-bookings').innerHTML = '';
  }
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

  // Collect booking selections
  const bookings = [];
  document.querySelectorAll('#trials-list .trial-row input[type="checkbox"]').forEach((cb) => {
    if (!cb.checked) return;
    const code = cb.dataset.code;
    const select = document.querySelector(`[data-slot-for="${code}"]`);
    const start_at = select?.value;
    if (start_at) bookings.push({ trial_code: code, start_at });
  });

  // Validate: any checked trial must have a time picked
  const checkedButNoTime = Array.from(document.querySelectorAll('#trials-list .trial-row input[type="checkbox"]'))
    .filter((cb) => {
      if (!cb.checked) return false;
      const code = cb.dataset.code;
      const select = document.querySelector(`[data-slot-for="${code}"]`);
      return !select?.value;
    });
  if (checkedButNoTime.length > 0) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Mark me in the Scroll';
    renderErrors(['Pick a time slot for each trial you have selected.']);
    return;
  }

  const payload = {
    name: (data.get('name') || '').toString().trim(),
    email: (data.get('email') || '').toString().trim(),
    house: (data.get('house') || '').toString().trim() || null,
    rings_pursued: rings,
    event_id: (data.get('event_id') || '').toString(),
    preferred_date: null,
    preferred_time: null,
    bookings,
  };

  const { ok, status, body } = await api('POST', '/api/seekers', payload);

  if (ok && body && body.ok) {
    showSuccess(payload.name, body.bookings);
    return;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Mark me in the Scroll';

  if (status === 422 && body) {
    if (body.error === 'slot_taken') {
      renderErrors([`The slot for ${body.trial_code} was just taken. Refreshing availability — please pick another time.`]);
      // Re-fetch availability
      onEventChange();
      return;
    }
    if (body.error === 'no_window' || body.error === 'self_overlap' || body.error === 'unknown_trial' || body.error === 'not_bookable') {
      renderErrors([body.detail || body.error]);
      return;
    }
    if (Array.isArray(body.errors)) {
      renderErrors(body.errors);
      return;
    }
  }
  const detail = (body && (body.error || body.detail)) || 'Unknown error';
  renderErrors([detail]);
}

document.addEventListener('DOMContentLoaded', () => {
  bindRingCards();
  loadEvents();
  $('#intake-form').addEventListener('submit', handleSubmit);
});
