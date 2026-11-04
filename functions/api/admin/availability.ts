import {onRequestGet as publicAvailability} from '../public/availability';
import {jsonResponse} from '../../_middleware';
import type {Env} from '../../lib/db';
export const onRequestGet:PagesFunction<Env>=async context=>{
 const connected=!!context.env.TALIA_CALENDAR_ICS_URL;
 if(!connected)return jsonResponse({ok:false,calendar_connected:false,error:'Talia’s calendar is not connected. These hours cannot be confirmed as available.'},503);
 const response=await publicAvailability(context);
 const data=await response.json() as Record<string,unknown>;
 return jsonResponse({...data,calendar_connected:true,checked_at:new Date().toISOString(),time_zone:context.env.EVENT_TIME_ZONE||'America/Chicago'},response.status);
};
