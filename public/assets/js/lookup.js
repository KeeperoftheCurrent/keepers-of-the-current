import { api } from './api.js';

const $ = sel => document.querySelector(sel);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const PILLARS = {
  body: { name: 'Body', ring: 'Endurance' },
  mind: { name: 'Mind', ring: 'Focus' },
  soul: { name: 'Soul', ring: 'Connection' },
};
const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

// Stored booking values are event-local wall times. Never parse them as a
// visitor's local timestamp: doing so shifts appointments for travelling users.
function formatDate(date) {
  if (!date) return 'Dates to be announced';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}
function formatTime(iso) {
  const [hour, minute] = iso.slice(11, 16).split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
function eventDates(reg) {
  if (!reg.starts_on) return 'Dates to be announced';
  return formatDate(reg.starts_on) + (reg.ends_on && reg.ends_on !== reg.starts_on ? ` – ${formatDate(reg.ends_on)}` : '');
}
function bookingTime(booking) {
  const endDate = booking.end_at.slice(0, 10);
  return `${formatDate(booking.start_at.slice(0, 10))} · ${formatTime(booking.start_at)} – ${endDate !== booking.start_at.slice(0, 10) ? formatDate(endDate) + ' · ' : ''}${formatTime(booking.end_at)}`;
}

function renderError(message) {
  const wrap = $('#errors');
  wrap.hidden = !message;
  wrap.textContent = message || '';
  wrap.className = message ? 'error-list' : '';
  if (message) wrap.focus();
}
function show(section) {
  $('#form-wrap').hidden = section !== 'form';
  $('#result').hidden = section !== 'result';
  $('#not-found').hidden = section !== 'not-found';
  if (section === 'result') $('#result-name').focus();
  if (section === 'not-found') $('#not-found-title').focus();
}
function clearDetails() {
  $('#lookup-form').reset();
  for (const id of ['result-name', 'result-house', 'result-titles', 'result-rings', 'result-pillars', 'result-bookings', 'result-registrations', 'result-history-content']) {
    document.getElementById(id).textContent = '';
  }
  $('#result-history').open = false;
  renderError(null);
  show('form');
  $('#lookup-form input[name="name"]').focus();
}

function renderResult(seeker) {
  $('#result-name').textContent = seeker.name;
  $('#result-house').textContent = seeker.house ? `of House ${seeker.house}` : 'Every step is part of the path.';
  $('#result-titles').innerHTML = [
    seeker.master_of_three_rings ? '<div class="title-banner">✦ Master of the Three Rings</div>' : '',
    seeker.shield ? '<div class="title-banner">Shield of the Current</div>' : '',
  ].join('');
  $('#result-rings').innerHTML = Object.entries(PILLARS).map(([pillar, label]) => {
    const held = seeker.rings[pillar];
    const count = seeker.pillar_counts[pillar].complete;
    return `<div class="ring-card ${held ? 'held' : ''}">
      <img src="/assets/img/ring_${pillar}.png" alt="" width="54" height="54">
      <strong>${label.ring}</strong><span>${held ? 'Ring earned' : count ? `${count} of 3 tiers` : 'Path awaits'}</span>
    </div>`;
  }).join('');

  const bookings = seeker.bookings || [];
  const upcomingBookings = bookings.filter(b => !b.past);
  $('#time-zone-note').textContent = seeker.time_zone === 'America/Chicago'
    ? 'All times are Central Time at the gathering.' : 'All times are local to the gathering.';
  $('#result-bookings').innerHTML = upcomingBookings.length
    ? upcomingBookings.map(b => `<article class="booking-card">
        <h3>${escapeHtml(b.trial_name)}</h3>
        <p class="booking-time">${escapeHtml(bookingTime(b))}</p>
        <p class="quiet">${escapeHtml(b.event_name)} · ${PILLARS[b.pillar].name}, Tier ${ROMAN[b.tier]}</p>
        ${b.event_active ? '' : '<p>This gathering is inactive. Check the arrangements with the Keeper.</p>'}
      </article>`).join('')
    : '<p class="empty-state">No upcoming trial times are booked. Register for a gathering to choose a Tier I appointment, or speak with the Keeper to arrange your next tier.</p>';

  const pursued = Array.isArray(seeker.rings_pursued) ? seeker.rings_pursued : [];
  $('#result-pillars').innerHTML = Object.entries(PILLARS).map(([pillar, label]) => {
    const tiers = seeker.tier_progress[pillar];
    const next = seeker.next_tiers[pillar];
    const count = seeker.pillar_counts[pillar].complete;
    const guidance = next === 1
      ? 'Begin at an upcoming gathering. Choose any Tier I appointment you need when registering.'
      : next === 2
        ? 'Continue at a later gathering than Tier I. Speak with the Keeper to arrange this tier.'
        : 'Grand Gathering only, once per year. Speak with the Keeper to confirm your next attempt.';
    return `<article class="pillar-block">
      <h3>${label.name} · Ring of ${label.ring}</h3>
      <p class="quiet small">${count} of ${tiers.length} tiers complete${pursued.includes(pillar) ? '' : ' · Not currently pursuing'}</p>
      <ol class="tier-progress" aria-label="${label.name} tier progress">${tiers.map(tier => {
        const state = tier.complete ? 'complete' : tier.tier === next ? 'next' : 'later';
        return `<li class="${state}">Tier ${ROMAN[tier.tier]}<span>${tier.complete ? '✓ Complete' : tier.tier === next ? 'Next step' : 'Earlier tiers first'}</span></li>`;
      }).join('')}</ol>
      ${next ? `<p class="next-step"><strong>Next: Tier ${ROMAN[next]}.</strong> ${guidance}</p>
        <a class="journey-link" href="/trials.html#${pillar}-tier-${next}">Read the Tier ${ROMAN[next]} trials →</a>`
        : `<p class="next-step">All tiers recorded.${seeker.rings[pillar] ? ' Your ring is earned.' : ' Ask the Keeper to review your ring award.'}</p>`}
    </article>`;
  }).join('');

  // Multiple registrations for one event are kept in the database; show its
  // most recent registration once so the personal calendar is easy to scan.
  const seen = new Set();
  const regs = (seeker.registrations || []).filter(reg => {
    if (seen.has(reg.event_id)) return false;
    seen.add(reg.event_id);
    return true;
  });
  const upcoming = regs.filter(reg => !reg.past).sort((a, b) => (a.starts_on || '9999').localeCompare(b.starts_on || '9999'));
  $('#result-registrations').innerHTML = upcoming.length ? upcoming.map(reg => `<article class="gathering-card">
      <h3>${escapeHtml(reg.event_name || reg.event_id)}</h3>
      <p class="quiet">${escapeHtml(eventDates(reg))}</p>
      <p class="small">Registration saved${reg.event_active ? '' : ' · Gathering inactive; check with the Keeper'}.</p>
      ${reg.email_status === 'failed' ? '<p class="small">Your confirmation email could not be sent. Your registration is still saved.</p>' : ''}
      ${reg.email_status === 'pending' ? '<p class="quiet small">Confirmation email pending.</p>' : ''}
    </article>`).join('') : '<p class="empty-state">You have no upcoming registrations. Your progress stays in the Scroll between gatherings.</p>';

  const pastRegs = regs.filter(reg => reg.past);
  const pastBookings = bookings.filter(b => b.past).reverse();
  $('#result-history').hidden = !pastRegs.length && !pastBookings.length;
  $('#result-history-content').innerHTML =
    (pastRegs.length ? `<h3>Gatherings</h3><ul>${pastRegs.map(reg => `<li>${escapeHtml(reg.event_name || reg.event_id)}<br>${escapeHtml(eventDates(reg))}</li>`).join('')}</ul>` : '') +
    (pastBookings.length ? `<h3>Booked times</h3><ul>${pastBookings.map(b => `<li>${escapeHtml(b.trial_name)} · ${escapeHtml(b.event_name)}<br>${escapeHtml(bookingTime(b))}</li>`).join('')}</ul>` : '');
}

async function handleSubmit(event) {
  event.preventDefault();
  renderError(null);
  const form = event.target;
  const data = new FormData(form);
  const payload = { name: String(data.get('name') || '').trim(), email: String(data.get('email') || '').trim() };
  if (!payload.name || !payload.email) { renderError('Enter both the name and email from your registration.'); return; }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Opening your Scroll…';
  form.setAttribute('aria-busy', 'true');
  try {
    const { ok, body } = await api('POST', '/api/seekers/lookup', payload);
    if (!ok || !body || typeof body.ok !== 'boolean') {
      renderError('Could not reach the Scroll. Your details are still here; please try again.');
    } else if (body.ok && body.seeker) {
      renderResult(body.seeker);
      show('result');
    } else show('not-found');
  } catch {
    renderError('Could not load your trials. Please try again in a moment.');
  } finally {
    button.disabled = false;
    button.textContent = 'Show my trials';
    form.removeAttribute('aria-busy');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#lookup-form').addEventListener('submit', handleSubmit);
  $('#lookup-again').addEventListener('click', clearDetails);
  $('#not-found-again').addEventListener('click', () => {
    show('form');
    $('#lookup-form input[name="name"]').focus();
  });
});
