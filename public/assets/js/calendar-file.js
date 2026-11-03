// Event-local times use an explicit timezone so travelling seekers keep the right appointment.
export function downloadCalendar(booking) {
 const escape=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const stamp=s=>s.replace(/[-:]/g,'').slice(0,13)+'00';
 const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Keepers of the Current//My Trials//EN','BEGIN:VEVENT',`UID:${booking.id}@keepersofthecurrent.org`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;TZID=America/Chicago:${stamp(booking.start_at)}`,`DTEND;TZID=America/Chicago:${stamp(booking.end_at)}`,`SUMMARY:${escape(booking.trial_name)}`,'LOCATION:Confirm meeting place with the Keeper',`DESCRIPTION:${escape(booking.event_name+' — Check My Trials for changes. Contact the Keeper to confirm your meeting place.')}`,'END:VEVENT','END:VCALENDAR',''].join('\r\n');
 const url=URL.createObjectURL(new Blob([text],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='keeper-trial.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
