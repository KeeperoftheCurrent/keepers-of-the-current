import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(tmpdir()+'/keeper-calendar-');
await build({entryPoints:['functions/lib/calendar-busy.ts'],bundle:true,platform:'node',format:'esm',outfile:dir+'/calendar.mjs'});
const {calendarBusy,getCalendarBusy}=await import(pathToFileURL(dir+'/calendar.mjs'));
const feed=events=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;
test('calendar respects Central time, all-day busy events, free events and recurring exclusions',()=>{
 const text=feed(`BEGIN:VEVENT\r\nUID:trial\r\nDTSTART:20261109T220000Z\r\nDTEND:20261109T221500Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:daily\r\nDTSTART:20261108T180000Z\r\nDTEND:20261108T190000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261109T180000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:free\r\nDTSTART;VALUE=DATE:20261109\r\nDTEND;VALUE=DATE:20261110\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT`);
 assert.deepEqual(calendarBusy(text,'2026-11-09T00:00','2026-11-09T23:59'),[{start_at:'2026-11-09T16:00',buffer_until:'2026-11-09T16:15'}]);
 const allDay=feed('BEGIN:VEVENT\r\nUID:busy\r\nDTSTART;VALUE=DATE:20261109\r\nDTEND;VALUE=DATE:20261110\r\nEND:VEVENT');
 assert.deepEqual(calendarBusy(allDay,'2026-11-09T00:00','2026-11-09T23:59'),[{start_at:'2026-11-09T00:00',buffer_until:'2026-11-10T00:00'}]);
});
test('configured calendar failures do not silently report free time',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:503}));
 await assert.rejects(getCalendarBusy({TALIA_CALENDAR_ICS_URL:'https://calendar.google.com/calendar/ical/test/basic.ics'},'2026-11-09','2026-11-10'));
});
await rm(dir,{recursive:true,force:true});
