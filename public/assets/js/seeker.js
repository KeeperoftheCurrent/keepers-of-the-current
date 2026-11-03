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
    requires_slot: true, gg_only: false,
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
    code: 's_t1', tier: 1, pillar: 'soul', short: 'Soul I',
    name: 'The Approach or The Gift', sub: 'Choose either path',
    requires_slot: false, gg_only: false,
    note: 'Choose either a meaningful conversation with a stranger or a handmade gift to a stranger. Read the rules, then report back to the Keeper.',
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


let step = 0, events = [], catalog = TRIAL_CATALOG, seeker = null;
let availability = {}, loading = false, availabilityFailed = false, generation = 0, submitting = false;
let choices = {}, requestId = crypto.randomUUID();
const draftKey = 'keeper-trial-plan-v2';
const form = $('#intake-form');
const field = name => form.elements.namedItem(name);
const rings = () => [...form.querySelectorAll('[name=rings_pursued]:checked')].map(e => e.value);
const event = () => events.find(e => e.id === field('event_id').value);
const chosen = () => catalog.filter(t => choices[t.code]?.selected && rings().includes(t.pillar) && eligible(t));
function eligible(t) { if(t.tier===2 && event()?.starts_on){const previous=(seeker?.requirements||[]).filter(r=>r.pillar===t.pillar&&r.tier===1);const earlier=r=>r.complete&&r.first_completed_on<event().starts_on;if(previous.length && !(previous[0].tier_aggregation==='any'?previous.some(earlier):previous.every(earlier)))return false;} return t.tier === (seeker?.next_tiers?.[t.pillar] ?? (seeker ? 0 : 1)) && (!t.gg_only || event()?.kind === 'grand_gathering') && !seeker?.requirements?.some(r => r.code === t.code && r.complete); }
function dateLabel(value) { return new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}); }
function timeLabel(value) { const [h,m] = value.slice(11,16).split(':').map(Number); return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; }
function slotLabel(value) { return `${dateLabel(value)} · ${timeLabel(value)} Central`; }
function error(message) { const el=$('#errors'); el.hidden=!message; el.textContent=message||''; if(message){el.focus();el.scrollIntoView({block:'center',behavior:'smooth'});} }
function save() { try { sessionStorage.setItem(draftKey,JSON.stringify({choices,event:field('event_id').value,rings:rings(),name:field('name').value,email:field('email').value,house:field('house').value,requestId,updated:Date.now()})); } catch {} }
function change() { requestId=crypto.randomUUID();save();$('#plan-count').textContent=`${chosen().length} trial${chosen().length===1?'':'s'} in your plan`; }
function go(n) {step=n; error(null);if(events.length)$('#load-status').textContent='';document.querySelectorAll('[data-step]').forEach(el=>el.hidden=Number(el.dataset.step)!==n);document.querySelectorAll('.flow-steps li').forEach((el,i)=>{if(i===n)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});$('#back-btn').hidden=n===0;$('#next-btn').hidden=n===3;$('#submit-btn').hidden=n!==3;$('#next-btn').textContent=['Choose trials →','Your details →','Review my plan →'][n]||'';if(n===3)review();document.querySelector(`[data-step="${n}"] h2`).focus();}
function validate(n) {
 if(!event())return 'Choose a gathering to continue.';
 if(n>=1){
  if(!rings().length)return 'Choose at least one ring to pursue.';
  if(loading)return 'Times are still loading. Please try again in a moment.';
  if(availabilityFailed&&chosen().some(t=>t.requires_slot))return 'We could not check appointment times. Tap Try loading times again.';
  const spans=[];
  for(const t of chosen()){
   const c=choices[t.code];
   if(t.requires_slot){
    if(!c.time||!availability[t.code]?.available_starts.includes(c.time))return `Choose an available day and time for ${t.name}.`;
    const end=new Date(new Date(c.time+':00Z').getTime()+((t.duration||0)+(t.buffer||0))*60000).toISOString().slice(0,16);
    if(spans.some(s=>c.time<s.end&&s.start<end))return 'Two trial times overlap, including the Keeper’s preparation time. Choose times farther apart.';
    spans.push({start:c.time,end});
   } else if(c.time && (c.time.slice(0,10)<event().starts_on||c.time.slice(0,10)>(event().ends_on||event().starts_on)))return `Choose a preferred time within the gathering dates for ${t.name}.`;
  }
 }
 if(n>=2){if(!field('name').value.trim())return 'Enter your character name.';if(!field('email').value||!field('email').checkValidity())return 'Enter a valid email address for your confirmation.';}
 return null;
}
function render() {
 const list=$('#trials-list');
 list.innerHTML=['body','mind','soul'].filter(p=>rings().includes(p)).map(p=>{
  const trials=catalog.filter(t=>t.pillar===p&&eligible(t));
  const alternative=trials.some(t=>t.tier===1)&&(p==='mind'||p==='soul')?'<p>Choose either path to complete Tier I. You do not need both.</p>':'';
  return `<div class="pillar-group"><h3>${p[0].toUpperCase()+p.slice(1)}</h3>${alternative}${trials.length?trials.map(t=>{
   const c=choices[t.code]||{},slots=availability[t.code]?.available_starts||[],days=[...new Set(slots.map(s=>s.slice(0,10)))];
   const day=c.day||c.time?.slice(0,10)||'';
   const unavailable=t.requires_slot&&(loading||availabilityFailed||!slots.length);
   return `<article class="trial-row ${c.selected?'selected':''}" data-code="${t.code}"><label class="head"><input type="checkbox" data-choice="${t.code}" ${c.selected?'checked':''} ${unavailable&&!c.selected?'disabled':''}><span><span class="trial-name">${escapeHtml(t.short)} — ${escapeHtml(t.name)}</span><br><span class="trial-meta">${t.requires_slot?`${t.duration} minutes · Appointment`:'Planned trial · No time reserved'}${t.sub?' · '+escapeHtml(t.sub):''}</span></span></label>
    <a href="/trials.html#${t.pillar}-tier-${t.tier}" target="_blank" rel="noopener">Rules & preparation ↗</a>
    ${t.requires_slot?`<div class="slot-picker"><label>Day<select data-day="${t.code}"><option value="">Choose a day</option>${days.map(d=>`<option value="${d}" ${d===day?'selected':''}>${dateLabel(d)}</option>`).join('')}</select></label><label>Time · Central<select data-time="${t.code}"><option value="">${day?'Choose a time':'Choose a day first'}</option>${slots.filter(s=>s.startsWith(day)&&day).map(s=>`<option value="${s}" ${s===c.time?'selected':''}>${timeLabel(s)}</option>`).join('')}</select></label></div>${unavailable?`<p class="full-msg">${loading?'Loading times…':availabilityFailed?'Times could not load. Please retry above.':'No appointments open. You can register now and contact the Keeper to arrange a time.'}</p>`:''}`:
    `<div class="notify-confirm" ${c.selected?'':'hidden'}><p>${escapeHtml(t.note||'Agree on the requirements and witness with the Keeper before starting.')} A preferred time is a request, not a confirmed appointment.</p><label>Preferred time · Central (optional)<input type="datetime-local" data-time="${t.code}" value="${escapeHtml(c.time||'')}" min="${event()?.starts_on||''}T00:00" max="${event()?.ends_on||event()?.starts_on||''}T23:59"></label></div>`}</article>`;
  }).join(''):'<p>No new trials are available in this ring at this gathering. Check My Trials for recorded progress. Tier II needs a later gathering than Tier I; Tier III requires a Grand Gathering.</p>'}</div>`;
 }).join('');
 list.querySelectorAll('[data-choice]').forEach(cb=>cb.addEventListener('change',()=>{const code=cb.dataset.choice;choices[code]={...choices[code],selected:cb.checked};change();render();list.querySelector(`[data-choice="${code}"]`)?.focus();}));
 list.querySelectorAll('[data-day]').forEach(el=>el.addEventListener('change',()=>{choices[el.dataset.day]={...choices[el.dataset.day],day:el.value,time:''};change();render();list.querySelector(`[data-time="${el.dataset.day}"]`)?.focus();}));
 list.querySelectorAll('[data-time]').forEach(el=>el.addEventListener('change',()=>{choices[el.dataset.time]={...choices[el.dataset.time],time:el.value};change();}));
}
async function loadTimes() {
 const id=++generation,ev=event();availability={};availabilityFailed=false;
 if(!ev){render();return;}
 loading=true;$('#availability-status').textContent='Checking appointment times…';$('#retry-times').hidden=true;render();
 const result=await api('GET',`/api/public/availability?event_id=${encodeURIComponent(ev.id)}`);
 if(id!==generation)return;
 loading=false;availabilityFailed=!result.ok||!result.body?.trials;availability=result.body?.trials||{};
 $('#availability-status').textContent=availabilityFailed?'We could not load appointment times. Your plan is still saved.':'All times are Central. Appointments are checked again when you confirm.';$('#retry-times').hidden=!availabilityFailed;render();
}
function review(){
 $('#plan-review').innerHTML=`<h3>${escapeHtml(event().name)}</h3><p>${escapeHtml(field('name').value)} · ${escapeHtml(field('email').value)}</p>`+ (chosen().length?chosen().map(t=>{const c=choices[t.code];return `<article class="plan-card"><h3>${escapeHtml(t.name)}</h3><p>${t.requires_slot?'Appointment to reserve':'Planned trial — no appointment reserved'}</p><p>${c.time?slotLabel(c.time):'Agree on timing with the Keeper'}</p><button type="button" data-edit="${t.code}">Edit</button><button type="button" data-remove="${t.code}">Remove</button></article>`;}).join(''):'<p>Gathering registration only. No trial times will be reserved.</p>');
 $('#plan-review').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{go(1);document.querySelector(`[data-choice="${b.dataset.edit}"]`)?.focus();});
 $('#plan-review').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{choices[b.dataset.remove].selected=false;change();render();review();$('#plan-review').closest('section').querySelector('h2').focus();});
}
async function submit(e){
 e.preventDefault();if(submitting)return;if(step!==3){const msg=validate(step);if(msg)error(msg);else go(step+1);return;}
 const msg=validate(2);if(msg){go(1);error(msg);return;}
 submitting=true;$('#submit-btn').disabled=true;$('#submit-btn').textContent='Saving your plan…';error(null);
 const payload={name:field('name').value.trim(),email:field('email').value.trim(),house:field('house').value.trim()||null,rings_pursued:rings(),event_id:event().id,request_id:requestId,bookings:chosen().filter(t=>t.requires_slot).map(t=>({trial_code:t.code,start_at:choices[t.code].time})),trial_intentions:chosen().filter(t=>!t.requires_slot).map(t=>({code:t.code,preferred_time:choices[t.code].time||null}))};
 const result=await api('POST','/api/seekers',payload);
 submitting=false;$('#submit-btn').disabled=false;$('#submit-btn').textContent='Confirm registration';
 if(result.ok&&result.body?.ok){try{sessionStorage.removeItem(draftKey);}catch{}$('#form-wrap').hidden=true;$('#success').hidden=false;$('#success-name').textContent=payload.name;$('#success-bookings').innerHTML=(result.body.bookings||[]).map(b=>`<p><strong>Booked: ${escapeHtml(catalog.find(t=>t.code===b.trial_code)?.name||b.trial_code)}</strong><br>${slotLabel(b.start_at)}</p>`).join('')+payload.trial_intentions.map(t=>`<p>Planned: ${escapeHtml(catalog.find(c=>c.code===t.code)?.name||t.code)}<br>No appointment reserved${t.preferred_time?' · Requested '+slotLabel(t.preferred_time):''}</p>`).join('');$('#success').focus();$('#success').scrollIntoView({block:'start'});return;}
 if(['slot_taken','past_slot','no_window','self_overlap'].includes(result.body?.error)){go(1);await loadTimes();}
 error(result.body?.detail||result.body?.errors?.join(' ')||'We could not confirm your plan. Your choices are saved. Please try again.');
}
async function init(){
 $('#load-status').textContent='Loading gatherings…';$('#retry-load').hidden=true;
 const [ev,cat,session]=await Promise.all([api('GET','/api/public/events'),api('GET','/api/public/trials'),api('POST','/api/seekers/lookup',{action:'session'})]);
 if(!ev.ok||!cat.ok){$('#load-status').textContent='Could not load the form. Check your connection and try again.';$('#retry-load').hidden=false;return;}
 events=ev.body.events;seeker=session.body?.seeker||null;
 catalog=cat.body.trials.map(t=>({...TRIAL_CATALOG.find(c=>c.code===t.code),...t,name:TRIAL_CATALOG.find(c=>c.code===t.code)?.name||t.name,short:`${t.pillar[0].toUpperCase()+t.pillar.slice(1)} ${['','I','II','III'][t.tier]}`,requires_slot:!!t.bookable,duration:t.duration_minutes,buffer:t.buffer_minutes}));
 field('event_id').innerHTML='<option value="">Choose a gathering</option>'+events.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} · ${e.starts_on?dateLabel(e.starts_on):'Dates to come'}</option>`).join('');
 let draft;try{draft=JSON.parse(sessionStorage.getItem(draftKey));}catch{}
 if(draft&&Date.now()-draft.updated<86400000){choices=draft.choices||{};requestId=draft.requestId||crypto.randomUUID();field('event_id').value=draft.event;for(const n of ['name','email','house'])field(n).value=draft[n]||'';form.querySelectorAll('[name=rings_pursued]').forEach(el=>el.checked=(draft.rings||[]).includes(el.value));}
 if(seeker){field('name').value=seeker.name;field('email').value=seeker.email;field('email').readOnly=true;field('house').value=seeker.house||'';if(!draft)form.querySelectorAll('[name=rings_pursued]').forEach(el=>el.checked=seeker.rings_pursued.includes(el.value));$('#welcome').textContent=`Welcome back, ${seeker.name}. Your recorded progress is saved; eligible next trials are shown below.`;}
 $('#load-status').textContent=events.length?'':'No upcoming gatherings are open yet. Please check back.';$('#next-btn').disabled=!events.length;
 await loadTimes();save();
}
$('#next-btn').onclick=()=>{const msg=validate(step);if(msg)error(msg);else go(step+1);};$('#back-btn').onclick=()=>go(step-1);
$('#retry-load').onclick=init;$('#retry-times').onclick=loadTimes;
field('event_id').addEventListener('change',()=>{choices={};change();loadTimes();$('#load-status').textContent='Gathering changed. Choose trial times for this gathering.';});
form.querySelectorAll('[name=rings_pursued]').forEach(el=>el.addEventListener('change',()=>{change();render();}));
for(const n of ['name','email','house'])field(n).addEventListener('input',change);
$('#clear-draft').onclick=()=>{choices={};$('#plan-count').textContent='0 trials in your plan';form.reset();requestId=crypto.randomUUID();try{sessionStorage.removeItem(draftKey);}catch{}if(seeker){field('name').value=seeker.name;field('email').value=seeker.email;field('house').value=seeker.house||'';}loadTimes();go(0);};
form.addEventListener('submit',submit);go(0);init();
