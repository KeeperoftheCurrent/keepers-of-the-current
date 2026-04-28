import { api } from './api.js';

const $ = (sel) => document.querySelector(sel);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Full trial catalog for the seeker form.
//
//   requires_slot  true  → Keeper must be present at a specific booked time.
//                          Shows availability + time picker.
//   requires_slot  false → No appointment needed, but the Keeper still needs
//                          to know you're planning this trial at this event.
//                          Shows a "notify the Keeper" checkbox instead.
//
//   gg_only        true  → Only available at a Grand Gathering.
//   tier                 → Tiers must be completed in order within a pillar.
//                          New seekers may only attempt Tier I.
const TRIAL_CATALOG = [

  // ── Body ─────────────────────────────────────────────────────────────────
  {
    code: 'b_t1', tier: 1, pillar: 'body', short: 'Body I',
    name: 'Awakening of Flesh', sub: 'The Fast + The Watch (both required)',
    requires_slot: false, gg_only: false,
    note: 'The Keeper must be notified before your Fast window begins so she can witness the release.',
  },
  {
    code: 'b_t2', tier: 2, pillar: 'body', short: 'Body II',
    name: 'The Unison', sub: null,
    requires_slot: false, gg_only: false,
    note: 'All three performers must be present together at the event.',
  },
  {
    code: 'b_t3_burden', tier: 3, pillar: 'body', short: 'Body III',
    name: 'The Burden', sub: 'The Grand Proving',
    requires_slot: true, duration: 15, buffer: 15, gg_only: true,
    note: 'The Keeper places the relic at your nominated start time. Grand Gathering only.',
  },

  // ── Mind ─────────────────────────────────────────────────────────────────
  {
    code: 'm_t1_dilemma', tier: 1, pillar: 'mind', short: 'Mind I',
    name: 'The Dilemma', sub: null,
    requires_slot: true, duration: 60, buffer: 30, gg_only: false,
    note: '60-minute philosophical session with the Keeper — book a time below.',
  },
  {
    code: 'm_t1_recitation', tier: 1, pillar: 'mind', short: 'Mind I',
    name: 'The Recitation', sub: null,
    requires_slot: true, duration: 30, buffer: 15, gg_only: false,
    note: 'Deliver a memorised passage to the Keeper — book a time below.',
  },
  {
    code: 'm_t2', tier: 2, pillar: 'mind', short: 'Mind II',
    name: 'The Vow of Silence', sub: null,
    requires_slot: false, gg_only: false,
    note: 'A Bearer witnesses your 3-hour silence window. Let the Keeper know in advance.',
  },
  {
    code: 'm_t3', tier: 3, pillar: 'mind', short: 'Mind III',
    name: 'The Telling', sub: null,
    requires_slot: false, gg_only: true,
    note: 'Host a gathering and report back to the Keeper. Grand Gathering only.',
  },

  // ── Soul ─────────────────────────────────────────────────────────────────
  {
    code: 's_t1_approach', tier: 1, pillar: 'soul', short: 'Soul I',
    name: 'The Approach', sub: null,
    requires_slot: false, gg_only: false,
    note: 'Speak with a stranger at the event; return to the Keeper with an introduction.',
  },
  {
    code: 's_t1_gift', tier: 1, pillar: 'soul', short: 'Soul I',
    name: 'The Gift', sub: null,
    requires_slot: false, gg_only: false,
    note: 'Give something handmade to a stranger; return to the Keeper and describe them.',
  },
  {
    code: 's_t2', tier: 2, pillar: 'soul', short: 'Soul II',
    name: 'The Service', sub: null,
    requires_slot: false, gg_only: false,
    note: 'Serve another event on their terms. The beneficiary attests; let the Keeper know afterward.',
  },
  {
    code: 's_t3_testament', tier: 3, pillar: 'soul', short: 'Soul III',
    name: 'The Tea Ceremony', sub: null,
    requires_slot: true, duration: 60, buffer: 30, gg_only: true,
    note: 'Private meeting with the Keeper. Grand Gathering only — book a time below.',
  },
  {
    code: 's_t3_final_introduction', tier: 3, pillar: 'soul', short: 'Soul III',
    name: 'The Final Introduction', sub: 'Gift of the Coin',
    requires_slot: false, gg_only: true,
    note: 'New member must be registered before the coin passes. Grand Gathering only.',
  },
];

// New seekers have completed nothing. Only Tier I is available to them.
// Higher tiers unlock as prior tiers are completed (enforced here and on re-registration).
const NEW_SEEKER_MAX_TIER = 1;

// Convenience: catalog entries that need a booked time slot.
const SLOTTED_TRIALS = TRIAL_CATALOG.filter((t) => t.requires_slot);

// ── Toast ──────────────────────────────────────────────────────────────────

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

// ── Event date formatting ──────────────────────────────────────────────────

function fmtEventDates(starts, ends) {
  if (!starts) return 'dates TBD';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [sy, sm, sd] = starts.split('-').map(Number);
  if (!ends || ends === starts) return `${MONTHS[sm - 1]} ${sd}, ${sy}`;
  const [ey, em, ed] = ends.split('-').map(Number);
  if (sm === em && sy === ey) return `${MONTHS[sm - 1]} ${sd}–${ed}, ${sy}`;
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
}

function fmtSlot(iso) {
  const [date, time] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const day = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const hour12 = ((hh + 11) % 12) + 1;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  return `${day} — ${hour12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

// ── Event loading ──────────────────────────────────────────────────────────

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
    options.push(`<option value="${escapeHtml(ev.id)}" data-kind="${escapeHtml(ev.kind)}" data-starts="${escapeHtml(ev.starts_on || '')}" data-ends="${escapeHtml(ev.ends_on || '')}">${escapeHtml(ev.name)}${star}${escapeHtml(dates)}</option>`);
  }
  select.innerHTML = options.join('');
  select.addEventListener('change', onEventChange);
}

// ── Ring card visual binding ───────────────────────────────────────────────

function bindRingCards() {
  document.querySelectorAll('.checkbox-row label').forEach((label) => {
    const input = label.querySelector('input[type="checkbox"]');
    const sync = () => label.classList.toggle('checked', input.checked);
    input.addEventListener('change', sync);
    sync();
  });
}

function getSelectedRings() {
  return Array.from(document.querySelectorAll('input[name="rings_pursued"]:checked')).map((cb) => cb.value);
}

// ── Availability + trial rendering ────────────────────────────────────────

// Keyed by trial code → { available_starts: string[] }.
// Set to {} (not null) once we have fetched availability, even if empty.
// null means "no event selected yet — hide the section entirely."
let currentAvailability = null;
let currentIsGG = false;
let currentEventDates = { starts: null, ends: null };

async function onEventChange() {
  const select = $('#event_id');
  const eventId = select.value;
  const eventOption = select.options[select.selectedIndex];
  currentIsGG = eventOption?.dataset.kind === 'grand_gathering';
  currentEventDates = {
    starts: eventOption?.dataset.starts || null,
    ends:   eventOption?.dataset.ends   || null,
  };

  if (!eventId) {
    currentAvailability = null;
    renderTrialList(currentIsGG, getSelectedRings());
    return;
  }

  // Fetch availability only for slotted trials (notification-only trials
  // don't need windows — they're shown unconditionally when the event is set).
  const codes = SLOTTED_TRIALS.map((t) => t.code).join(',');
  const { ok, body } = await api('GET', `/api/public/availability?event_id=${encodeURIComponent(eventId)}&trial_codes=${codes}`);

  // Even on failure we set availability to {} so notification-only trials
  // are still visible — the seeker can still notify the Keeper.
  currentAvailability = (ok && body?.trials) ? body.trials : {};
  renderTrialList(currentIsGG, getSelectedRings(), currentEventDates);
}

function renderTrialList(isGG, selectedRings = [], eventDates = {}) {
  const list = $('#trials-list');
  const trialsSection = $('#trials-section');

  // No event selected — hide the whole section.
  if (currentAvailability === null) {
    list.innerHTML = '';
    trialsSection.hidden = true;
    return;
  }

  const PILLARS = [
    { key: 'body', label: 'Body — the Ring of Endurance' },
    { key: 'mind', label: 'Mind — the Ring of Focus' },
    { key: 'soul', label: 'Soul — the Ring of Connection' },
  ];

  list.innerHTML = PILLARS.map((p) => {
    // Skip pillars for rings the seeker has not chosen to pursue.
    if (selectedRings.length > 0 && !selectedRings.includes(p.key)) return '';

    // Only show Tier I — higher tiers require prior completion of all earlier tiers.
    const trials = TRIAL_CATALOG.filter((t) => t.pillar === p.key && t.tier <= NEW_SEEKER_MAX_TIER);

    const trialsHtml = trials.map((t) => {
      // Tier III (and any GG-only trial) is not available at regular events.
      if (t.gg_only && !isGG) return '';

      if (t.requires_slot) {
        // ── Slotted trial: show availability + time picker ───────────────
        const slots = currentAvailability?.[t.code]?.available_starts || [];
        const isFull = slots.length === 0;
        const slotOptions = slots.map((s) => `<option value="${s}">${fmtSlot(s)}</option>`).join('');
        const duration = `${t.duration} min`;
        return `<div class="trial-row" data-code="${t.code}">
          <label class="head">
            <input type="checkbox" data-code="${t.code}" ${isFull ? 'disabled' : ''}>
            <div>
              <div class="trial-name">${escapeHtml(t.short)} — ${escapeHtml(t.name)}</div>
              <div class="trial-meta">${duration}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
            </div>
          </label>
          <div class="slot-picker">
            <span class="label-text">Choose a time</span>
            <select data-slot-for="${t.code}" required>
              <option value="">— choose a time —</option>
              ${slotOptions}
            </select>
          </div>
          ${isFull ? `<div class="full-msg">No slots are currently open for this trial at this gathering — speak with the Keeper at the event to arrange a time.</div>` : ''}
        </div>`;
      } else {
        // ── Notification-only trial: no slot needed, but seeker can state a preferred time ──
        const subLine = t.sub ? `<div class="trial-meta" style="font-style:italic;">${escapeHtml(t.sub)}</div>` : '';
        const minDt = eventDates.starts ? `${eventDates.starts}T06:00` : '';
        const maxDt = (eventDates.ends || eventDates.starts) ? `${eventDates.ends || eventDates.starts}T23:59` : '';
        const dtAttrs = [
          minDt ? `min="${minDt}"` : '',
          maxDt ? `max="${maxDt}"` : '',
          minDt ? `value="${minDt.slice(0, 11)}12:00"` : '',
        ].filter(Boolean).join(' ');
        return `<div class="trial-row notify-only" data-code="${t.code}">
          <label class="head">
            <input type="checkbox" data-code="${t.code}" data-notify-only="true">
            <div>
              <div class="trial-name">${escapeHtml(t.short)} — ${escapeHtml(t.name)}</div>
              ${subLine}
              <div class="trial-meta">${escapeHtml(t.note)}</div>
            </div>
          </label>
          <div class="notify-confirm" style="display:none;margin-top:8px;padding:8px 12px 8px 26px;background:rgba(200,150,62,0.06);border-left:2px solid var(--gold-dim);border-radius:0 3px 3px 0;">
            <div style="font-size:13px;color:var(--text-dim);margin-bottom:10px;">The Keeper will be notified. This trial doesn't need a reserved slot — pick a preferred time and she'll expect you then.</div>
            <label style="display:block;">
              <span style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px;">Preferred time <span style="opacity:0.6;">(optional)</span></span>
              <input type="datetime-local" data-pref-time-for="${t.code}" ${dtAttrs}
                style="background:var(--red-dark);color:var(--text-light);border:1px solid var(--border);border-radius:3px;padding:6px 8px;font-family:var(--serif);font-size:13px;width:100%;max-width:260px;color-scheme:dark;">
            </label>
          </div>
        </div>`;
      }
    }).filter(Boolean).join('');

    if (!trialsHtml) return '';
    return `<div class="pillar-group"><h4>${escapeHtml(p.label)}</h4>${trialsHtml}</div>`;
  }).join('');

  // Show the section if anything rendered (event selected + at least one ring chosen).
  const hasContent = list.innerHTML.trim().length > 0;
  trialsSection.hidden = !hasContent;

  // Bind checkbox toggles for slotted trials (toggle selected class + slot picker).
  list.querySelectorAll('.trial-row:not(.notify-only) input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      cb.closest('.trial-row').classList.toggle('selected', cb.checked);
    });
  });

  // Bind checkbox toggles for notification-only trials (show/hide confirm note).
  list.querySelectorAll('.trial-row.notify-only input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const row = cb.closest('.trial-row');
      row.classList.toggle('selected', cb.checked);
      const note = row.querySelector('.notify-confirm');
      if (note) note.style.display = cb.checked ? 'block' : 'none';
    });
  });
}

// ── Success screen ─────────────────────────────────────────────────────────

function showSuccess(name, bookings, intentions) {
  $('#form-wrap').hidden = true;
  $('#success').hidden = false;
  $('#success-name').textContent = name;

  const parts = [];

  if (bookings && bookings.length > 0) {
    const lines = bookings.map((b) => {
      const trial = TRIAL_CATALOG.find((t) => t.code === b.trial_code);
      return `<li><strong>${escapeHtml(trial?.name || b.trial_code)}</strong> · ${escapeHtml(fmtSlot(b.start_at))}</li>`;
    }).join('');
    parts.push(`<p>Booked trial time(s):</p><ul style="text-align:left;display:inline-block;margin:0 auto;">${lines}</ul>`);
  }

  if (intentions && intentions.length > 0) {
    const lines = intentions.map((code) => {
      const trial = TRIAL_CATALOG.find((t) => t.code === code);
      const label = trial ? `${trial.short} — ${trial.name}` : code;
      return `<li>${escapeHtml(label)}</li>`;
    }).join('');
    parts.push(`<p>The Keeper has been notified you plan to attempt:</p><ul style="text-align:left;display:inline-block;margin:0 auto;">${lines}</ul>`);
  }

  $('#success-bookings').innerHTML = parts.join('');
}

// ── Form submission ────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();
  const submitBtn = $('#submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Marking the Scroll…';
  renderErrors(null);

  const form = e.target;
  const data = new FormData(form);
  const rings = data.getAll('rings_pursued');

  // Collect slot bookings (requires_slot trials with a time selected).
  const bookings = [];
  // Collect notification intentions (notify-only trials the seeker checked).
  const trial_intentions = [];

  document.querySelectorAll('#trials-list .trial-row input[type="checkbox"]').forEach((cb) => {
    if (!cb.checked) return;
    const code = cb.dataset.code;
    if (cb.dataset.notifyOnly === 'true') {
      const prefInput = document.querySelector(`[data-pref-time-for="${code}"]`);
      trial_intentions.push({ code, preferred_time: prefInput?.value || null });
    } else {
      const select = document.querySelector(`[data-slot-for="${code}"]`);
      const start_at = select?.value;
      if (start_at) bookings.push({ trial_code: code, start_at });
    }
  });

  // Validate: any checked slotted trial must have a time selected.
  const checkedButNoTime = Array.from(
    document.querySelectorAll('#trials-list .trial-row:not(.notify-only) input[type="checkbox"]')
  ).filter((cb) => {
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
    trial_intentions,
  };

  const { ok, status, body } = await api('POST', '/api/seekers', payload);

  if (ok && body && body.ok) {
    showSuccess(payload.name, body.bookings, trial_intentions);
    return;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Mark me in the Scroll';

  if (status === 422 && body) {
    if (body.error === 'slot_taken') {
      renderErrors([`The slot for ${body.trial_code} was just taken. Refreshing availability — please pick another time.`]);
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

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindRingCards();
  loadEvents();
  $('#intake-form').addEventListener('submit', handleSubmit);

  // Re-render the trial list when ring selections change.
  document.querySelectorAll('input[name="rings_pursued"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      renderTrialList(currentIsGG, getSelectedRings(), currentEventDates);
    });
  });
});
