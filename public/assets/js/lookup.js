import { downloadCalendar } from './calendar-file.js';
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
  if (section === 'result') $('#result-name').focus();
}
function clearDetails() {
  $('#lookup-form').reset();
  for (const id of ['result-name', 'result-house', 'result-titles', 'result-rings', 'result-pillars', 'result-bookings', 'result-registrations', 'result-history-content','result-intentions','result-attempts','booking-editor','booking-status']) {
    document.getElementById(id).textContent = '';
  }
  $('#result-history').open = false;
  renderError(null);
  show('form');
  $('#lookup-form input[name="email"]').focus();
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
        <p><button type="button" data-calendar="${b.id}">Add to calendar</button> <button type="button" data-change="${b.id}">Change time</button> <button type="button" data-cancel="${b.id}">Cancel booking</button></p>
        ${b.event_active ? ''  : '<p>This gathering is inactive. Check the arrangements with the Keeper.</p>'}
      </article>`).join('')
    : '<p class="empty-state">No upcoming trial times are booked. Choose a gathering to see the trials available for your next tier.</p>';

  $('#result-intentions').innerHTML=(seeker.registrations||[]).filter(r=>!r.past).flatMap(r=>(r.trial_intentions||[]).map(i=>`<p><strong>${escapeHtml((seeker.requirements||[]).find(t=>t.code===i.code)?.name||i.code)}</strong> · ${escapeHtml(r.event_name)}<br>${i.preferred_time?escapeHtml(formatDate(i.preferred_time.slice(0,10))+' · '+formatTime(i.preferred_time)+' Central · requested time'):'Agree on timing with the Keeper'}<br>No time reserved.</p>`)).join('')||'<p>No planned trials recorded.</p>';
  $('#result-attempts').innerHTML=(seeker.attempts||[]).map(a=>`<p>${escapeHtml(a.name)} · ${escapeHtml(a.completed_on)} · ${a.outcome==='passed'?'Passed':'Not passed — ask the Keeper about your next attempt'}</p>`).join('')||'<p>No attempts recorded yet.</p>';
  $('#result-bookings').querySelectorAll('[data-calendar]').forEach(b=>b.onclick=()=>downloadCalendar(bookings.find(x=>x.id===b.dataset.calendar)));
  $('#result-bookings').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>editBooking(bookings.find(x=>x.id===b.dataset.cancel),'cancel'));
  $('#result-bookings').querySelectorAll('[data-change]').forEach(b=>b.onclick=()=>editBooking(bookings.find(x=>x.id===b.dataset.change),'reschedule'));

  const pursued = Array.isArray(seeker.rings_pursued) ? seeker.rings_pursued : [];
  $('#result-pillars').innerHTML = Object.entries(PILLARS).map(([pillar, label]) => {
    const tiers = seeker.tier_progress[pillar];
    const next = seeker.next_tiers[pillar];
    const count = seeker.pillar_counts[pillar].complete;
    const guidance = next === 1
      ? 'Begin at an upcoming gathering. Choose any Tier I appointment you need when registering.'
      : next === 2
        ? 'Continue at a later gathering than Tier I. Choose your next trial below; confirm the arrangements with the Keeper.'
        : 'Grand Gathering only, once per year. Choose your next trial below; confirm your next eligible attempt with the Keeper.';
    return `<article class="pillar-block">
      <h3>${label.name} · Ring of ${label.ring}</h3>
      <p class="quiet small">${count} of ${tiers.length} tiers complete${pursued.includes(pillar) ? '' : ' · Not currently pursuing'}</p>
      <ol class="tier-progress" aria-label="${label.name} tier progress">${tiers.map(tier => {
        const state = tier.complete ? 'complete' : tier.tier === next ? 'next' : 'later';
        return `<li class="${state}">Tier ${ROMAN[tier.tier]}<span>${tier.complete ? '✓ Complete' : tier.tier === next ? 'Next step' : 'Earlier tiers first'}</span></li>`;
      }).join('')}</ol>
      <details class="optional"><summary>See each requirement</summary><ul>${(seeker.requirements||[]).filter(r=>r.pillar===pillar).map(r=>`<li>${r.complete?'✓':'○'} Tier ${ROMAN[r.tier]} · ${escapeHtml(r.name)} — ${r.complete?'Complete':'Not yet recorded as complete'}</li>`).join('')}</ul></details>
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

async function signIn(action, fields = {}) {
  const response = await fetch('/api/seekers/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Sign-in request failed');
  return response.json();
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = $('#lookup-form');
  const status = $('#sign-in-status');
  const redeem = $('#redeem-link');
  const token = new URLSearchParams(location.hash.slice(1)).get('sign-in');

  form.addEventListener('submit', async event => {
    event.preventDefault();
    renderError(null);
    status.textContent = '';
    const email = form.elements.email;
    if (!email.checkValidity()) { email.reportValidity(); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await signIn('request', { email: email.value });
      status.textContent = 'If that email is registered, a sign-in link is on its way. Check your inbox and spam folder.';
    } catch {
      renderError('Could not request a link. Please try again.');
    } finally {
      if(status.textContent){button.textContent='Link sent · resend in 60 seconds';setTimeout(()=>{button.disabled=false;button.textContent='Email me another sign-in link';},60000);}else button.disabled=false;
    }
  });

  $('#lookup-again').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await signIn('logout');
      status.textContent = '';
      clearDetails();
    } catch {
      status.textContent = '';
      window.alert('Could not sign out. Please try again.');
    } finally {
      button.disabled = false;
    }
  });

  if (token) {
    history.replaceState(null, '', location.pathname + location.search);
    redeem.hidden = false;
    form.hidden = true;
    redeem.addEventListener('click', async () => {
      redeem.disabled = true;
      try {
        const result = await signIn('redeem', { token });
        if (result?.seeker) {
          renderResult(result.seeker);
          show('result');
        } else {
          renderError('This link has expired or has already been used. Request a new link below.');
        }
      } catch {
        renderError('Could not open your trials. Request a new link below.');
      } finally {
        redeem.hidden = true;
        form.hidden = false;
      }
    });
    return;
  }

  try {
    const result = await signIn('session');
    if (result?.seeker) {
      renderResult(result.seeker);
      show('result');
    }
  } catch {
    renderError('Could not load your trials. Please refresh or request a new link.');
  }
});

async function editBooking(booking, action) {
 const editor=$('#booking-editor');editor.hidden=false;editor.innerHTML='<p>Loading…</p>';editor.focus();
 let starts=[];
 if(action==='reschedule'){
  try {const response=await fetch(`/api/public/availability?event_id=${encodeURIComponent(booking.event_id)}&trial_codes=${encodeURIComponent(booking.trial_code)}`);if(!response.ok)throw new Error();starts=(await response.json()).trials[booking.trial_code]?.available_starts||[];}catch{editor.textContent='Could not load times. Your booking is unchanged. Try again.';return;}
 }
 editor.innerHTML=`<h3>${action==='cancel'?'Cancel':'Change'} ${escapeHtml(booking.trial_name)}?</h3><p>Your recorded trial progress will be kept.</p>${action==='reschedule'?'<label>Day<select id="change-day"><option value="">Choose a day</option>'+[...new Set(starts.map(s=>s.slice(0,10)))].map(d=>`<option value="${d}">${formatDate(d)}</option>`).join('')+'</select></label><label>Time · Central<select id="change-time"><option value="">Choose a day first</option></select></label>':''}<button id="confirm-booking-change">${action==='cancel'?'Cancel this booking':'Save new time'}</button><button id="keep-booking">Keep current booking</button><p id="change-error" role="alert"></p>`;
 $('#keep-booking').onclick=()=>editor.hidden=true;
 if(action==='reschedule')$('#change-day').onchange=()=>{$('#change-time').innerHTML='<option value="">Choose a time</option>'+starts.filter(s=>s.startsWith($('#change-day').value)&&$('#change-day').value).map(s=>`<option value="${s}">${formatTime(s)}</option>`).join('');};
 $('#confirm-booking-change').onclick=async()=>{
  const start_at=$('#change-time')?.value;
  if(action==='reschedule'&&!start_at){$('#change-error').textContent='Choose a new day and time.';return;}
  $('#confirm-booking-change').disabled=true;
  try{const response=await fetch('/api/seekers/booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:booking.id,start_at})});const data=await response.json();if(!response.ok)throw new Error(data.detail||'Please sign in again and retry.');const result=await signIn('session');if(!result?.seeker)throw new Error('Please sign in again to see your updated booking.');renderResult(result.seeker);editor.hidden=true;$('#booking-status').textContent=action==='cancel'?'Booking canceled. Your progress is unchanged.':'New time saved. Update any copy in your personal calendar.';}
  catch(e){$('#change-error').textContent=e.message;$('#confirm-booking-change').disabled=false;}
 };
}
