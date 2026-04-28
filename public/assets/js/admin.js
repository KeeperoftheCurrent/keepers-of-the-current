import { api } from './api.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtDate = (ts) => new Date(ts * 1000).toLocaleString();

let allEvents = [];
let allSeekers = [];
let activeTab = 'seekers';

// ─── Hynafol 2026 calendar seed data ─────────────────────────────────────
// IDs MUST match migration 0007 exactly — schedule windows are keyed to these.
const HYNAFOL_2026 = [
  { id: 'festival_of_champions_2026', name: 'Festival of Champions', kind: 'expedition',      starts_on: '2026-05-22', ends_on: '2026-05-25', active: true },
  { id: 'courtly_night_2026',         name: 'A Courtly Night',       kind: 'expedition',      starts_on: '2026-09-12', ends_on: '2026-09-12', active: true },
  { id: 'october_expedition_2026',    name: 'October Expedition',    kind: 'expedition',      starts_on: '2026-10-09', ends_on: '2026-10-11', active: true },
  { id: 'gg_2026',                    name: 'Grand Gathering 2026',  kind: 'grand_gathering', starts_on: '2026-11-08', ends_on: '2026-11-15', active: true },
];

function showToast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast visible' + (kind === 'error' ? ' error' : '');
  setTimeout(() => (t.className = 'toast'), 3000);
}

function openModal(title, bodyHtml) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-backdrop').hidden = false;
}
function closeModal() {
  $('#modal-backdrop').hidden = true;
  $('#modal-body').innerHTML = '';
}

// ─── tabs ─────────────────────────────────────────────────────────────
function switchTab(name) {
  activeTab = name;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.tabPanel !== name));
  if (name === 'seekers')   loadSeekers();
  if (name === 'schedule')  loadEventsForSchedule();
  if (name === 'windows')   loadEventsForWindows();
  if (name === 'events')    loadEventsTab();
  if (name === 'log')       loadLog();
}

// ─── seekers ──────────────────────────────────────────────────────────
async function loadSeekers() {
  const { ok, body } = await api('GET', '/api/admin/seekers');
  if (!ok) return showToast('Could not load seekers', 'error');
  allSeekers = body.seekers || [];
  renderSeekers(allSeekers);
}
function renderSeekers(list) {
  const tbody = $('#seekers-table tbody');
  if (list.length === 0) {
    tbody.innerHTML = '';
    $('#seekers-empty').hidden = false;
    return;
  }
  $('#seekers-empty').hidden = true;
  tbody.innerHTML = list.map((s) => {
    const awards = s.active_awards || [];
    const hasRing = (k) => awards.includes(k);
    const ringDots = `<div class="ring-dots">
      <span class="ring-dot body${hasRing('ring_body') ? '' : ' dim'}" title="Body"></span>
      <span class="ring-dot mind${hasRing('ring_mind') ? '' : ' dim'}" title="Mind"></span>
      <span class="ring-dot soul${hasRing('ring_soul') ? '' : ' dim'}" title="Soul"></span>
    </div>`;
    const title = awards.includes('shield') ? '🛡 Shield'
      : awards.includes('master_title') ? '★ Master of Three Rings'
      : (Array.isArray(s.rings_pursued) ? 'Seeker' : 'Seeker');
    return `<tr data-id="${escapeHtml(s.id)}">
      <td>${escapeHtml(s.name)}<div class="muted" style="font-size:12px;">${escapeHtml(s.email)}</div></td>
      <td>${escapeHtml(s.house || '—')}</td>
      <td>${ringDots}</td>
      <td>${title}</td>
      <td>${s.passed_trials} passed</td>
      <td><span class="muted" style="font-size:12px;">${s.registrations_count} reg.</span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => openSeekerDetail(tr.dataset.id));
  });
}

async function openSeekerDetail(id) {
  const { ok, body } = await api('GET', `/api/admin/seekers/${id}`);
  if (!ok) return showToast('Could not load seeker', 'error');
  const s = body.seeker;
  const events = allEvents.length ? allEvents : (await api('GET', '/api/admin/events')).body?.events || [];
  const trialOptions = (await api('GET', '/api/admin/seekers/' + id)).body?.progress || [];

  const awards = body.awards || [];
  const activeAwards = awards.filter((a) => !a.revoked_at);
  const hasMaster = activeAwards.some((a) => a.kind === 'master_title');
  const hasShield = activeAwards.some((a) => a.kind === 'shield');

  const progressList = (body.progress || []).map((p) => `
    <li>
      <strong>${escapeHtml(p.trial_code)}</strong>: ${p.completed ? '✓' : '·'}
    </li>`).join('');

  const eventsByCode = new Map(events.map((e) => [e.id, e]));
  const trialEventsList = (body.trial_events || []).map((te) => `
    <li>
      <strong>${escapeHtml(te.trial_name)}</strong>
      <span class="muted">${escapeHtml(te.completed_on)} · ${escapeHtml(te.outcome)}</span>
      ${te.witness ? `· witness: ${escapeHtml(te.witness)}` : ''}
      ${te.note ? `<br><em class="muted" style="font-size:12px;">${escapeHtml(te.note)}</em>` : ''}
      ${te.voided_at ? `<br><span style="color:#c45a5a;">VOIDED — ${escapeHtml(te.void_reason || '')}</span>` : ''}
    </li>`).join('') || '<li class="muted">No trial events recorded.</li>';

  const awardsList = activeAwards.map((a) => `
    <li><strong>${escapeHtml(a.kind)}</strong> · ${escapeHtml(a.awarded_on)} ${a.auto_conferred ? '(auto)' : '(manual)'}</li>`)
    .join('') || '<li class="muted">No active awards.</li>';

  const registrationsList = (body.registrations || []).map((r) => {
    const ev = eventsByCode.get(r.event_id);
    return `<li>
      <strong>${escapeHtml(ev?.name || r.event_id)}</strong>
      <span class="muted">${escapeHtml(r.preferred_date || '')} ${escapeHtml(r.preferred_time || '')}</span>
      <span class="email-status ${escapeHtml(r.email_status)}">${escapeHtml(r.email_status)}</span>
    </li>`;
  }).join('') || '<li class="muted">No registrations.</li>';

  const trialDropdownOptions = (await fetchCatalog()).map((c) => `<option value="${c.code}">${escapeHtml(c.short_label)} — ${escapeHtml(c.name)}</option>`).join('');
  const eventDropdownOptions = events.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');

  openModal(s.name, `
    <div class="muted" style="margin-bottom:16px;">${escapeHtml(s.email)} · House ${escapeHtml(s.house || '—')}</div>

    <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
      <button class="primary" id="btn-mark-progress">Mark progress</button>
      ${hasMaster && !hasShield ? '<button class="secondary" id="btn-confer-shield">Confer Shield</button>' : ''}
      <button class="secondary" id="btn-edit-seeker">Edit</button>
      <button class="secondary" id="btn-delete-seeker" style="color:#c45a5a; border-color:#c45a5a;">Delete</button>
    </div>

    <h4>Active awards</h4>
    <ul style="margin-bottom:16px;">${awardsList}</ul>

    <h4>Trial events (Trial Scroll)</h4>
    <ul style="margin-bottom:16px;">${trialEventsList}</ul>

    <h4>Registrations</h4>
    <ul style="margin-bottom:16px;">${registrationsList}</ul>

    <hr style="border-color:var(--border); margin:16px 0;">
    <details>
      <summary class="muted" style="cursor:pointer;">Per-trial completion grid</summary>
      <ul>${progressList}</ul>
    </details>
  `);

  $('#btn-mark-progress')?.addEventListener('click', () => openMarkProgressModal(s, trialDropdownOptions, eventDropdownOptions));
  $('#btn-confer-shield')?.addEventListener('click', () => openShieldModal(s, eventDropdownOptions));
  $('#btn-edit-seeker')?.addEventListener('click', () => openEditSeekerModal(s));
  $('#btn-delete-seeker')?.addEventListener('click', async () => {
    if (!confirm(`Delete ${s.name}? This is permanent and cascades to all their trial events, awards, and registrations.`)) return;
    const r = await api('DELETE', `/api/admin/seekers/${s.id}`);
    if (r.ok) { closeModal(); showToast('Seeker deleted'); loadSeekers(); }
    else showToast(r.body?.error || 'Delete failed', 'error');
  });
}

let cachedCatalog = null;
async function fetchCatalog() {
  if (cachedCatalog) return cachedCatalog;
  // No public catalog endpoint; reuse the seeker progress shape if available, else inline.
  // Quick win: hardcode catalog structure from the migration.
  cachedCatalog = [
    { code: 'b_t1',                    short_label: 'Body I',      name: 'Awakening of Flesh' },
    { code: 'b_t2',                    short_label: 'Body II',     name: 'The Form' },
    { code: 'b_t3_burden',             short_label: 'Body III',    name: 'The Burden' },
    { code: 'b_t3_plank',              short_label: 'Body III',    name: 'The Plank' },
    { code: 'b_t3_foot_race',          short_label: 'Body III',    name: 'The Foot Race' },
    { code: 'b_t3_course',             short_label: 'Body III',    name: 'The Course' },
    { code: 'm_t1_dilemma',            short_label: 'Mind I',      name: 'The Dilemma' },
    { code: 'm_t1_recitation',         short_label: 'Mind I',      name: 'The Recitation' },
    { code: 'm_t2',                    short_label: 'Mind II',     name: 'Discipline of Thought' },
    { code: 'm_t3',                    short_label: 'Mind III',    name: 'The Final Judgement' },
    { code: 's_t1',                    short_label: 'Soul I',      name: 'Awakening of Connection' },
    { code: 's_t2',                    short_label: 'Soul II',     name: 'Discipline of Connection' },
    { code: 's_t3_testament',          short_label: 'Soul III',    name: 'The Testament' },
    { code: 's_t3_final_introduction', short_label: 'Soul III',    name: 'The Final Introduction' },
  ];
  return cachedCatalog;
}

function openMarkProgressModal(s, trialOptions, eventOptions) {
  const today = new Date().toISOString().slice(0, 10);
  $('#modal-body').innerHTML = `
    <h4>Mark a trial event for ${escapeHtml(s.name)}</h4>
    <form id="progress-form">
      <label class="field">
        <span class="label-text">Trial</span>
        <select name="trial_code" required>${trialOptions}</select>
      </label>
      <div class="field-row">
        <label class="field">
          <span class="label-text">Completed on</span>
          <input type="date" name="completed_on" value="${today}" required>
        </label>
        <label class="field">
          <span class="label-text">Outcome</span>
          <select name="outcome">
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span class="label-text">Event</span>
        <select name="event_id"><option value="">— none —</option>${eventOptions}</select>
      </label>
      <label class="field">
        <span class="label-text">Witness <span class="muted">(name)</span></span>
        <input type="text" name="witness">
      </label>
      <label class="field">
        <span class="label-text">Note for the Scroll</span>
        <textarea name="note" rows="3"></textarea>
      </label>
      <label class="field" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" name="force"> <span class="muted">Force (override Body III gg-only enforcement)</span>
      </label>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel-progress">Cancel</button>
        <button type="submit" class="primary">Record</button>
      </div>
    </form>
  `;
  $('#cancel-progress').addEventListener('click', () => openSeekerDetail(s.id));
  $('#progress-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const payload = {
      seeker_id: s.id,
      trial_code: f.get('trial_code'),
      completed_on: f.get('completed_on'),
      event_id: f.get('event_id') || null,
      witness: f.get('witness') || null,
      note: f.get('note') || null,
      outcome: f.get('outcome'),
      force: f.get('force') === 'on',
    };
    const r = await api('POST', '/api/admin/progress', payload);
    if (r.ok) {
      const awards = r.body.awards;
      let msg = 'Trial event recorded';
      if (awards?.rings_added?.length) msg += `. Ring(s) auto-conferred: ${awards.rings_added.join(', ')}`;
      if (awards?.master_added) msg += '. Master of Three Rings auto-conferred!';
      showToast(msg);
      openSeekerDetail(s.id);
      loadSeekers();
    } else {
      showToast(r.body?.error || 'Could not record', 'error');
    }
  });
}

function openShieldModal(s, eventOptions) {
  const today = new Date().toISOString().slice(0, 10);
  $('#modal-body').innerHTML = `
    <h4>Confer the Shield of the Current upon ${escapeHtml(s.name)}</h4>
    <p class="muted">The Shield is reserved for a Master of Three Rings, tapped by the Keeper for a personal quest.</p>
    <form id="shield-form">
      <div class="field-row">
        <label class="field">
          <span class="label-text">Awarded on</span>
          <input type="date" name="awarded_on" value="${today}" required>
        </label>
        <label class="field">
          <span class="label-text">At event</span>
          <select name="event_id"><option value="">— none —</option>${eventOptions}</select>
        </label>
      </div>
      <label class="field">
        <span class="label-text">Ceremony note</span>
        <textarea name="ceremony_note" rows="3"></textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel-shield">Cancel</button>
        <button type="submit" class="primary">Confer Shield</button>
      </div>
    </form>
  `;
  $('#cancel-shield').addEventListener('click', () => openSeekerDetail(s.id));
  $('#shield-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('POST', '/api/admin/awards', {
      seeker_id: s.id,
      kind: 'shield',
      awarded_on: f.get('awarded_on'),
      event_id: f.get('event_id') || null,
      ceremony_note: f.get('ceremony_note') || null,
    });
    if (r.ok) { showToast('Shield conferred'); openSeekerDetail(s.id); loadSeekers(); }
    else showToast(r.body?.error || 'Could not confer Shield', 'error');
  });
}

function openEditSeekerModal(s) {
  $('#modal-body').innerHTML = `
    <h4>Edit ${escapeHtml(s.name)}</h4>
    <form id="edit-form">
      <label class="field">
        <span class="label-text">Name</span>
        <input type="text" name="name" value="${escapeHtml(s.name)}" required>
      </label>
      <label class="field">
        <span class="label-text">House</span>
        <input type="text" name="house" value="${escapeHtml(s.house || '')}">
      </label>
      <label class="field">
        <span class="label-text">Keeper's notes <span class="muted">(private)</span></span>
        <textarea name="notes" rows="4">${escapeHtml(s.notes || '')}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel-edit">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  `;
  $('#cancel-edit').addEventListener('click', () => openSeekerDetail(s.id));
  $('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('PATCH', `/api/admin/seekers/${s.id}`, {
      name: f.get('name'),
      house: f.get('house'),
      notes: f.get('notes'),
    });
    if (r.ok) { showToast('Saved'); openSeekerDetail(s.id); loadSeekers(); }
    else showToast(r.body?.error || 'Save failed', 'error');
  });
}

// ─── schedule ─────────────────────────────────────────────────────────
async function loadEventsForSchedule() {
  if (!allEvents.length) await loadEventsTab(true);
  const sel = $('#schedule-event');
  sel.innerHTML = '<option value="">— choose an event —</option>' +
    allEvents.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  sel.onchange = () => renderSchedule(sel.value);
  if (sel.value) renderSchedule(sel.value);
}

async function renderSchedule(eventId) {
  if (!eventId) { $('#schedule-content').innerHTML = '<p class="muted">Choose an event to see its windows and bookings.</p>'; return; }
  const { ok, body } = await api('GET', `/api/admin/events/${eventId}/schedule`);
  if (!ok) { showToast('Could not load schedule', 'error'); return; }

  const { event, windows, bookings, open_registrations } = body;
  if (windows.length === 0) {
    $('#schedule-content').innerHTML = `
      <p class="muted">No working windows are configured for ${escapeHtml(event.name)}.</p>
      <button class="primary" onclick="window.location.hash='#windows'">Set up windows →</button>`;
    return;
  }

  // Group bookings by day
  const bookingsByDay = new Map();
  for (const b of bookings) {
    const day = b.start_at.slice(0, 10);
    if (!bookingsByDay.has(day)) bookingsByDay.set(day, []);
    bookingsByDay.get(day).push(b);
  }

  const html = windows.map((w) => {
    const dayBookings = (bookingsByDay.get(w.day_date) || []).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const bookingsHtml = dayBookings.map((b) => {
      const time = b.start_at.slice(11, 16);
      return `<div class="timeline-slot" data-booking-id="${escapeHtml(b.id)}">
        <div class="slot-time">${escapeHtml(time)}</div>
        <div class="slot-content">
          <div>
            <div class="seeker-name">${escapeHtml(b.seeker_name)}</div>
            <div class="trial-name">${escapeHtml(b.trial_name)}</div>
          </div>
          <div class="duration">${b.duration_minutes}m + ${b.buffer_minutes}m buf</div>
        </div>
      </div>`;
    }).join('') || '<div class="timeline-slot empty"><div class="slot-time">—</div><div class="slot-content muted">No bookings yet</div></div>';
    return `<div class="schedule-window">
      <div class="schedule-window-header">
        <span class="day">${escapeHtml(w.day_date)}</span>
        <span class="hours">${escapeHtml(w.start_time)} – ${escapeHtml(w.end_time)}</span>
      </div>
      <div class="timeline">${bookingsHtml}</div>
    </div>`;
  }).join('');

  const openRegHtml = open_registrations.length
    ? `<div class="open-registrations"><h4>Registered, no booking yet (${open_registrations.length})</h4><ul>${
        open_registrations.map((r) => `<li>${escapeHtml(r.seeker_name)} <span class="muted">(${escapeHtml(r.seeker_email)})</span></li>`).join('')
      }</ul></div>`
    : '';

  $('#schedule-content').innerHTML = html + openRegHtml;
}

// ─── windows config ───────────────────────────────────────────────────
let editingWindowsEventId = null;
let editingWindowsBuffer = [];

async function loadEventsForWindows() {
  if (!allEvents.length) await loadEventsTab(true);
  const sel = $('#windows-event');
  sel.innerHTML = '<option value="">— choose an event —</option>' +
    allEvents.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  sel.onchange = () => loadWindowsFor(sel.value);
  if (sel.value) loadWindowsFor(sel.value);
}

async function loadWindowsFor(eventId) {
  editingWindowsEventId = eventId;
  if (!eventId) { $('#windows-list').innerHTML = ''; editingWindowsBuffer = []; return; }
  const { ok, body } = await api('GET', `/api/admin/events/${eventId}/windows`);
  if (!ok) return showToast('Could not load windows', 'error');
  editingWindowsBuffer = body.windows || [];
  renderWindowsList();
}

function renderWindowsList() {
  $('#windows-list').innerHTML = editingWindowsBuffer.map((w, i) => `
    <div class="window-row">
      <input type="date" data-i="${i}" data-f="day_date" value="${escapeHtml(w.day_date)}">
      <input type="time" data-i="${i}" data-f="start_time" value="${escapeHtml(w.start_time)}">
      <input type="time" data-i="${i}" data-f="end_time" value="${escapeHtml(w.end_time)}">
      <button class="remove-btn" data-i="${i}">Remove</button>
    </div>
  `).join('') || '<p class="muted">No windows yet. Click + Add window.</p>';
  $$('#windows-list input').forEach((el) => {
    el.addEventListener('input', () => {
      const i = parseInt(el.dataset.i, 10);
      editingWindowsBuffer[i][el.dataset.f] = el.value;
    });
  });
  $$('#windows-list .remove-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const i = parseInt(b.dataset.i, 10);
      editingWindowsBuffer.splice(i, 1);
      renderWindowsList();
    });
  });
}

// ─── events ───────────────────────────────────────────────────────────
async function loadEventsTab(silent = false) {
  const { ok, body } = await api('GET', '/api/admin/events');
  if (!ok) {
    if (body?.authRequired) {
      if (!silent) showAuthBanner();
      return;
    }
    if (!silent) showToast('Could not load events', 'error');
    return;
  }
  allEvents = body.events || [];
  if (silent) return;

  renderEventsTable();
}

function renderEventsTable() {
  // Remove any previous seed banner
  const prev = $('#seed-banner');
  if (prev) prev.remove();

  $('#events-table tbody').innerHTML = allEvents.map((e) => `
    <tr data-id="${escapeHtml(e.id)}">
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.kind)}</td>
      <td>${escapeHtml(e.starts_on || 'TBD')} ${e.ends_on ? '→ ' + escapeHtml(e.ends_on) : ''}</td>
      <td>${e.active ? '✓' : '—'}</td>
      <td><button class="secondary" data-edit="${escapeHtml(e.id)}">Edit</button></td>
    </tr>
  `).join('');
  $$('#events-table button[data-edit]').forEach((b) => {
    b.addEventListener('click', (e) => { e.stopPropagation(); openEventEditModal(b.dataset.edit); });
  });

  // If empty, offer one-click seed of the 2026 Hynafol calendar
  if (allEvents.length === 0) {
    const banner = document.createElement('div');
    banner.id = 'seed-banner';
    banner.className = 'seed-banner';
    banner.innerHTML = `
      <div class="seed-banner-inner">
        <div class="seed-banner-text">
          <strong style="color:var(--gold)">No events yet.</strong>
          The Hynafol 2026 calendar is ready to load — six events from The Siege through The Grand Gathering.
        </div>
        <button class="primary" id="seed-calendar-btn">⚡ Seed Hynafol 2026 Calendar</button>
      </div>
    `;
    $('#events-table').closest('.card').appendChild(banner);
    $('#seed-calendar-btn').addEventListener('click', seedHynafolCalendar);
  }
}

async function seedHynafolCalendar() {
  const btn = $('#seed-calendar-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Seeding…'; }
  let added = 0, failed = 0;
  for (const ev of HYNAFOL_2026) {
    const r = await api('POST', '/api/admin/events', ev);
    if (r.ok) added++; else failed++;
  }
  if (failed === 0) {
    showToast(`✓ Hynafol 2026 calendar seeded — ${added} events added`);
  } else {
    showToast(`${added} added, ${failed} failed (some may already exist)`, failed === HYNAFOL_2026.length ? 'error' : 'info');
  }
  allEvents = [];
  await loadEventsTab();
}

function showAuthBanner() {
  const main = $('#admin-auth-banner');
  if (main) return; // already shown
  const banner = document.createElement('div');
  banner.id = 'admin-auth-banner';
  banner.className = 'auth-banner';
  banner.innerHTML = `
    <div class="auth-banner-inner">
      <strong>⚡ Authentication required</strong>
      <p>You need to log in via Cloudflare Access to use the Keeper's Panel.
         Open <a href="/admin.html" target="_blank">/admin.html</a> directly in your browser — it will redirect you to the login page.</p>
      <button class="secondary" onclick="window.location.reload()">Reload &amp; try again</button>
    </div>
  `;
  document.querySelector('.admin-main').prepend(banner);
}

function openNewEventModal() {
  openModal('Add event', `
    <form id="event-form">
      <label class="field">
        <span class="label-text">ID <span class="muted">(slug, e.g. courtly_night_2027)</span></span>
        <input name="id" placeholder="my_event_2027" required pattern="[a-z0-9_]+" title="Lowercase letters, numbers and underscores only">
      </label>
      <label class="field">
        <span class="label-text">Name</span>
        <input name="name" placeholder="A Courtly Night" required>
      </label>
      <div class="field-row">
        <label class="field">
          <span class="label-text">Kind</span>
          <select name="kind">
            <option value="expedition">Expedition</option>
            <option value="grand_gathering">Grand Gathering</option>
          </select>
        </label>
        <label class="field">
          <span class="label-text">Active</span>
          <select name="active">
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="label-text">Starts on</span>
          <input type="date" name="starts_on">
        </label>
        <label class="field">
          <span class="label-text">Ends on</span>
          <input type="date" name="ends_on">
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel-event">Cancel</button>
        <button type="submit" class="primary">Create</button>
      </div>
    </form>
  `);
  $('#cancel-event').addEventListener('click', closeModal);
  $('#event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('POST', '/api/admin/events', {
      id: f.get('id'),
      name: f.get('name'),
      kind: f.get('kind'),
      starts_on: f.get('starts_on') || null,
      ends_on: f.get('ends_on') || null,
      active: f.get('active') === '1',
    });
    if (r.ok) { showToast('Event created'); closeModal(); loadEventsTab(); allEvents = []; }
    else showToast(r.body?.error || 'Create failed', 'error');
  });
}

function openNewSeekerModal() {
  openModal('Add seeker', `
    <form id="add-seeker-form">
      <label class="field">
        <span class="label-text">Name</span>
        <input type="text" name="name" required>
      </label>
      <label class="field">
        <span class="label-text">Email</span>
        <input type="email" name="email" required>
      </label>
      <label class="field">
        <span class="label-text">House <span class="muted">(optional)</span></span>
        <input type="text" name="house">
      </label>
      <div class="field">
        <span class="label-text">Rings pursued</span>
        <div class="checkbox-row" role="group">
          <label><input type="checkbox" name="rings_pursued" value="body"> Body</label>
          <label><input type="checkbox" name="rings_pursued" value="mind"> Mind</label>
          <label><input type="checkbox" name="rings_pursued" value="soul"> Soul</label>
        </div>
      </div>
      <label class="field">
        <span class="label-text">First gathering</span>
        <select name="event_id" required>
          <option value="">— choose —</option>
          ${allEvents.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')}
        </select>
      </label>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel-add-seeker">Cancel</button>
        <button type="submit" class="primary">Add to Scroll</button>
      </div>
    </form>
  `);
  $('#cancel-add-seeker').addEventListener('click', closeModal);
  $('#add-seeker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('POST', '/api/seekers', {
      name: f.get('name'),
      email: f.get('email'),
      house: f.get('house') || null,
      rings_pursued: f.getAll('rings_pursued'),
      event_id: f.get('event_id'),
      preferred_date: null,
      preferred_time: null,
      bookings: [],
    });
    if (r.ok && r.body?.ok) { showToast('Seeker added'); closeModal(); loadSeekers(); }
    else showToast(r.body?.error || r.body?.errors?.join(', ') || 'Add failed', 'error');
  });
}

function openEventEditModal(id) {
  const ev = allEvents.find((e) => e.id === id);
  if (!ev) return;
  openModal(ev.name, `
    <form id="event-form">
      <label class="field">
        <span class="label-text">Name</span>
        <input name="name" value="${escapeHtml(ev.name)}" required>
      </label>
      <div class="field-row">
        <label class="field">
          <span class="label-text">Kind</span>
          <select name="kind">
            <option value="expedition" ${ev.kind === 'expedition' ? 'selected' : ''}>Expedition</option>
            <option value="grand_gathering" ${ev.kind === 'grand_gathering' ? 'selected' : ''}>Grand Gathering</option>
          </select>
        </label>
        <label class="field">
          <span class="label-text">Active</span>
          <select name="active">
            <option value="1" ${ev.active ? 'selected' : ''}>Yes</option>
            <option value="0" ${!ev.active ? 'selected' : ''}>No</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="label-text">Starts on</span>
          <input type="date" name="starts_on" value="${escapeHtml(ev.starts_on || '')}">
        </label>
        <label class="field">
          <span class="label-text">Ends on</span>
          <input type="date" name="ends_on" value="${escapeHtml(ev.ends_on || '')}">
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancel-event">Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  `);
  $('#cancel-event').addEventListener('click', closeModal);
  $('#event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('POST', '/api/admin/events', {
      id: ev.id,
      name: f.get('name'),
      kind: f.get('kind'),
      starts_on: f.get('starts_on') || null,
      ends_on: f.get('ends_on') || null,
      active: f.get('active') === '1',
    });
    if (r.ok) { showToast('Saved'); closeModal(); loadEventsTab(); allEvents = []; }
    else showToast(r.body?.error || 'Save failed', 'error');
  });
}

// ─── audit log ────────────────────────────────────────────────────────
async function loadLog() {
  const { ok, body } = await api('GET', '/api/admin/log?limit=200');
  if (!ok) return showToast('Could not load log', 'error');
  $('#log-table tbody').innerHTML = (body.entries || []).map((e) => `
    <tr>
      <td>${escapeHtml(fmtDate(e.ts))}</td>
      <td>${escapeHtml(e.actor_email)}</td>
      <td>${escapeHtml(e.action)}</td>
      <td>${escapeHtml((e.target_type || '') + (e.target_id ? ': ' + e.target_id.slice(0, 8) : ''))}</td>
      <td><div class="audit-detail">${escapeHtml(e.detail || '')}</div></td>
    </tr>
  `).join('');
}

// ─── boot ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', (e) => { if (e.target === $('#modal-backdrop')) closeModal(); });
  $('#seeker-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderSeekers(allSeekers.filter((s) => (s.name + ' ' + s.email).toLowerCase().includes(q)));
  });
  $('#add-event-btn').addEventListener('click', () => openNewEventModal());
  $('#add-seeker-btn').addEventListener('click', async () => {
    if (!allEvents.length) await loadEventsTab(true);
    openNewSeekerModal();
  });

  $('#windows-add-btn').addEventListener('click', () => {
    if (!editingWindowsEventId) return showToast('Choose an event first', 'error');
    editingWindowsBuffer.push({ day_date: '', start_time: '09:00', end_time: '17:00' });
    renderWindowsList();
  });
  $('#windows-save-btn').addEventListener('click', async () => {
    if (!editingWindowsEventId) return;
    const r = await api('PUT', `/api/admin/events/${editingWindowsEventId}/windows`, { windows: editingWindowsBuffer });
    if (r.ok) showToast(`Saved ${r.body.count} window(s)`);
    else showToast(r.body?.error || 'Save failed', 'error');
  });

  // Whoami via Cf-Access — not exposed via API; just show first part of email if available
  $('#admin-email').textContent = 'Keeper';

  switchTab('seekers');
});
