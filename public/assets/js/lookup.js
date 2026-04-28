import { api } from './api.js';

const $ = (sel) => document.querySelector(sel);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const PILLAR_LABELS = {
  body: { name: 'Body', subtitle: 'the Ring of Endurance' },
  mind: { name: 'Mind', subtitle: 'the Ring of Focus' },
  soul: { name: 'Soul', subtitle: 'the Ring of Connection' },
};

function renderErrors(errors) {
  const wrap = $('#errors');
  if (!errors || errors.length === 0) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;
  wrap.innerHTML = `<div class="error-list"><strong>${escapeHtml(errors[0])}</strong></div>`;
}

function show(section) {
  $('#form-wrap').hidden = section !== 'form';
  $('#result').hidden = section !== 'result';
  $('#not-found').hidden = section !== 'not-found';
}

function renderResult(seeker) {
  $('#result-name').textContent = seeker.name;
  $('#result-house').textContent = seeker.house ? `of House ${seeker.house}` : '';

  const titles = [];
  if (seeker.master_of_three_rings) titles.push(`<div class="title-banner" style="margin-bottom:8px;">★ Master of the Three Rings</div>`);
  if (seeker.shield) titles.push(`<div class="title-banner" style="background:rgba(176,174,166,0.08);border-color:var(--text-dim);color:var(--text-dim);">🛡 Shield of the Current</div>`);
  $('#result-titles').innerHTML = titles.join('');

  $('#result-rings').innerHTML = ['body', 'mind', 'soul'].map((p) => {
    const held = seeker.rings[p];
    return `<div class="ring-disc ${held ? 'held' : ''}">
      <div style="font-size:24px;">${held ? '◉' : '○'}</div>
      <div class="ring-label">${PILLAR_LABELS[p].name}</div>
    </div>`;
  }).join('');

  $('#result-pillars').innerHTML = ['body', 'mind', 'soul'].map((p) => {
    const c = seeker.pillar_counts[p];
    return `<div class="pillar-block">
      <div class="pillar-name">${PILLAR_LABELS[p].name} — ${PILLAR_LABELS[p].subtitle}</div>
      <div class="pillar-stat">${c.complete} / ${c.total} tiers complete</div>
    </div>`;
  }).join('');

  const regs = seeker.registrations || [];
  $('#result-registrations').innerHTML = regs.length === 0
    ? '<li class="muted">No upcoming gatherings.</li>'
    : regs.map((r) => `<li>${escapeHtml(r.event_name || r.event_id)}${r.preferred_date ? ` — ${escapeHtml(r.preferred_date)}` : ''}${r.preferred_time ? ` (${escapeHtml(r.preferred_time)})` : ''}</li>`).join('');
}

async function handleSubmit(e) {
  e.preventDefault();
  renderErrors(null);
  const data = new FormData(e.target);
  const payload = {
    name: (data.get('name') || '').toString().trim(),
    email: (data.get('email') || '').toString().trim(),
  };
  if (!payload.name || !payload.email) {
    renderErrors(['Both name and email are required.']);
    return;
  }

  const { ok, body } = await api('POST', '/api/seekers/lookup', payload);
  if (!ok) {
    renderErrors(['Could not reach the Scroll. Try again in a moment.']);
    return;
  }
  if (body.ok && body.seeker) {
    renderResult(body.seeker);
    show('result');
  } else {
    show('not-found');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#lookup-form').addEventListener('submit', handleSubmit);
  $('#lookup-again').addEventListener('click', () => { show('form'); $('#lookup-form').reset(); });
  $('#not-found-again').addEventListener('click', () => { show('form'); $('#lookup-form').reset(); });
});
