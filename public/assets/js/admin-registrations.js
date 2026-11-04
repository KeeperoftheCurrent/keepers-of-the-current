import{api}from'./api.js?v=20261103-admin';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records=[];
function draw(){
 const q=$('#registration-search').value.toLowerCase();const shown=records.filter(r=>(r.seeker_name+' '+r.seeker_email+' '+r.event_name).toLowerCase().includes(q));
 $('#registration-list').innerHTML=shown.map(r=>`<article class="card registration-card"><h3>${esc(r.seeker_name)}</h3><p><strong>${esc(r.event_name||r.event_id)}</strong><br>${esc(r.seeker_email)}</p><h4>Chosen trials · timing to arrange</h4>${r.choices.length?'<ul>'+r.choices.map(c=>`<li><strong>${esc(c.name)}</strong>${c.preferred_time?'<br>Requested: '+esc(c.preferred_time.replace('T',' '))+' Central':''}</li>`).join('')+'</ul><p class="muted">These choices do not reserve a time.</p>':'<p>No untimed trial choices.</p>'}<h4>Confirmed appointments</h4>${r.bookings.length?'<ul>'+r.bookings.map(b=>`<li><strong>${esc(b.trial_name)}</strong><br>${esc(b.start_at.replace('T',' '))} – ${esc(b.end_at.slice(11))} Central</li>`).join('')+'</ul>':'<p>No appointment reserved.</p>'}<p class="muted">Confirmation email: ${esc(r.seeker_email_status||'unknown')} · Keeper notification: ${esc(r.admin_email_status||'unknown')}</p><button class="primary" type="button" data-seeker="${esc(r.seeker_id)}">Open seeker &amp; record progress</button></article>`).join('')||'<p>No matching registrations.</p>';
 $('#registration-list').querySelectorAll('[data-seeker]').forEach(b=>b.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('admin-open-seeker',{detail:b.dataset.seeker}))));
}
async function refresh(){
 const status=$('#registration-status');status.textContent='Loading saved registrations…';
 const r=await api('GET','/api/admin/overview');
 if(!r.ok){status.textContent='Registrations could not be loaded. They have not been erased. Use secure sign-in above, or retry.';return;}
 records=r.body.registrations;draw();status.textContent=`${records.length} recent registrations loaded from the database. Newest first. Last checked ${new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.`;
 const n=r.body.pending_profiles.length;$('#pending-stories').textContent=n?`${n} member ${n===1?'story awaits':'stories await'} review →`:'Member stories: none awaiting review';
}
$('#registration-search').addEventListener('input',draw);$('#refresh-registrations').addEventListener('click',refresh);$('#pending-stories').addEventListener('click',()=>document.querySelector('[data-tab="members"]').click());
 document.addEventListener('admin-tab',e=>{if(e.detail==='registrations')refresh();});
