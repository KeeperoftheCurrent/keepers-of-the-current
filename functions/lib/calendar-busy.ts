import ICAL from 'ical.js';
import type { Env } from './db';
export type BusySpan = {start_at:string;buffer_until:string};
export function calendarBusy(text:string,from:string,to:string,timeZone='America/Chicago'):BusySpan[] {
 const root=new ICAL.Component(ICAL.parse(text));
 for(const zone of root.getAllSubcomponents('vtimezone'))ICAL.TimezoneService.register(new ICAL.Timezone(zone));
 const result:BusySpan[]=[];
 const components=root.getAllSubcomponents('vevent');
 const local=(t:ICAL.Time)=>{
  if(t.isDate||t.zone.tzid==='floating')return t.toString().slice(0,10)+'T'+(t.isDate?'00:00':t.toString().slice(11,16));
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t.toUnixTime()*1000)).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
 };
 const add=(item:ICAL.Event,start:ICAL.Time,end:ICAL.Time)=>{
  if(item.component.getFirstPropertyValue('status')==='CANCELLED'||item.component.getFirstPropertyValue('transp')==='TRANSPARENT')return;
  const a=local(start),b=local(end);if(a<to&&b>from)result.push({start_at:a,buffer_until:b});
 };
 for(const c of components){
  const e=new ICAL.Event(c);if(e.isRecurrenceException())continue;
  for(const exception of components.filter(x=>x.hasProperty('recurrence-id')&&x.getFirstPropertyValue('uid')===e.uid))e.relateException(exception);
  if(!e.isRecurring()){add(e,e.startDate,e.endDate);continue;}
  const iterator=e.iterator();let count=0,next;
  while((next=iterator.next())){
   if(++count>20000)throw new Error('Calendar recurrence exceeds safe expansion limit');
   if(local(next)>to)break;
   const occurrence=e.getOccurrenceDetails(next);add(occurrence.item,occurrence.startDate,occurrence.endDate);
  }
 }
 return result;
}
export async function getCalendarBusy(env:Env,from:string,to:string):Promise<BusySpan[]> {
 if(!env.TALIA_CALENDAR_ICS_URL)return [];
 const url=new URL(env.TALIA_CALENDAR_ICS_URL);
 if(url.protocol!=='https:'||url.hostname!=='calendar.google.com')throw new Error('Calendar connection needs attention');
 const response=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'manual',headers:{'Cache-Control':'no-cache'}});
 if(!response.ok)throw new Error('Calendar connection unavailable');
 return calendarBusy(await response.text(),from,to,env.EVENT_TIME_ZONE);
}
