import{api}from'./api.js?v=20261103-admin';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=s=>{const[h,m]=s.split(':');return `${Number(h)%12||12}:${m} ${Number(h)>=12?'PM':'AM'}`;};
let generation=0;
export async function renderAvailability(container,eventId){
 const request=++generation;
 if(!eventId){container.innerHTML='<p>Choose a gathering to check Talia’s calendar.</p>';return;}
 container.innerHTML='<p role="status">Checking Talia’s calendar and saved bookings…</p>';
 const result=await api('GET','/api/admin/availability?event_id='+encodeURIComponent(eventId));
 if(request!==generation)return;
 if(!result.ok){container.innerHTML='<p role="alert">'+esc(result.body?.error||result.body?.detail||'Calendar availability could not be checked. Refresh to retry.')+'</p><p>No times are being shown as confirmed available.</p>';return;}
 const trials=Object.values(result.body.trials||{});
 container.innerHTML='<h3>Bookable times · checked against Talia’s calendar</h3><p>These are the same appointment starts seekers can choose. Calendar busy periods, existing bookings, trial length and buffers are already excluded. All times are Central.</p><p class="muted">Checked '+esc(new Date(result.body.checked_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'. Refresh after changing your calendar. A requested time in a registration is not a booking.</p>'+trials.map(t=>{
 const days=new Map();for(const start of t.available_starts){const [date,time]=start.split('T');if(!days.has(date))days.set(date,[]);days.get(date).push(clock(time));}
 return '<details class="read-section"><summary>'+esc(t.name)+' · '+t.duration_minutes+' minutes + '+t.buffer_minutes+' minutes buffer · '+t.available_starts.length+' starts</summary><div class="availability-days">'+([...days].map(([date,times])=>'<section><h4>'+esc(date)+'</h4><p>'+times.map(esc).join(' · ')+'</p></section>').join('')||'<p>No bookable times remain within the opening hours.</p>')+'</div></details>';
 }).join('')+(trials.length?'':'<p>No appointment-based trials are configured.</p>');
}
