import type { Env } from '../../lib/db';
import { queryFirst } from '../../lib/db';
import { authenticateSeeker } from '../../lib/seeker-auth';
import { jsonResponse } from '../../_middleware';
import { onRequestGet as availability } from '../public/availability';
import { sendBookingUpdate } from '../../lib/email';
import { eventClock } from '../../lib/event-time';
export const onRequestPost: PagesFunction<Env> = async context => {
  const body = await context.request.clone().json() as {action:string;id:string;start_at?:string};
  const auth = await authenticateSeeker({...context, request:new Request(context.request,{body:JSON.stringify({action:'session'})})});
  if(auth instanceof Response)return auth;
  const booking = await queryFirst<{id:string;event_id:string;trial_code:string;start_at:string;duration_minutes:number;buffer_minutes:number}>(context.env,
    `SELECT b.*,tc.duration_minutes,tc.buffer_minutes FROM bookings b JOIN registrations r ON r.id=b.registration_id JOIN trial_catalog tc ON tc.code=b.trial_code
    WHERE b.id=? AND b.seeker_id=? AND b.voided_at IS NULL AND r.voided_at IS NULL`,body.id,auth.seekerId);
  if(!booking)return jsonResponse({ok:false,detail:'This appointment is no longer active.'},404);
  if(booking.start_at<eventClock(context.env.EVENT_TIME_ZONE).localDateTime)return jsonResponse({ok:false,detail:'For a past appointment, contact the Keeper.'},422);
  if(body.action==='cancel'){
    await context.env.DB.prepare("UPDATE bookings SET voided_at=?,voided_by='seeker',void_reason='Canceled in My Trials' WHERE id=? AND seeker_id=? AND voided_at IS NULL").bind(Math.floor(Date.now()/1000),body.id,auth.seekerId).run();
    context.waitUntil(sendBookingUpdate(context.env,auth.seekerId,booking.trial_code,'cancel',booking.start_at).catch(()=>console.error('[booking] Change email failed')));
    return jsonResponse({ok:true});
  }
  if(body.action!=='reschedule'||typeof body.start_at!=='string')return jsonResponse({ok:false},400);
  if(body.start_at===booking.start_at)return jsonResponse({ok:true});
  const url=new URL('/api/public/availability',context.request.url);url.searchParams.set('event_id',booking.event_id);url.searchParams.set('trial_codes',booking.trial_code);
  const response=await availability({...context,request:new Request(url)});
  const data=await response.json() as {trials?:Record<string,{available_starts:string[]}>};
  if(!data.trials?.[booking.trial_code]?.available_starts.includes(body.start_at))return jsonResponse({ok:false,detail:'That time is no longer available. Choose another time.'},422);
  const add=(n:number)=>new Date(new Date(body.start_at+':00Z').getTime()+n*60000).toISOString().slice(0,16);
  const end=add(booking.duration_minutes),buffer=add(booking.duration_minutes+booking.buffer_minutes);
  const changed=await context.env.DB.prepare(`UPDATE bookings SET start_at=?,end_at=?,buffer_until=? WHERE id=? AND seeker_id=? AND voided_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM bookings other WHERE other.id<>? AND other.voided_at IS NULL AND other.start_at<? AND other.buffer_until>?) RETURNING id`)
    .bind(body.start_at,end,buffer,body.id,auth.seekerId,body.id,buffer,body.start_at).first();
  if(changed)context.waitUntil(sendBookingUpdate(context.env,auth.seekerId,booking.trial_code,'reschedule',body.start_at).catch(()=>console.error('[booking] Change email failed')));
  return changed?jsonResponse({ok:true}):jsonResponse({ok:false,detail:'That time was just taken. Your original booking is unchanged.'},422);
};
