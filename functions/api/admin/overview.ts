import {queryAll,type Env} from '../../lib/db';
import {jsonResponse} from '../../_middleware';
export const onRequestGet:PagesFunction<Env>=async({env})=>{
 const registrations=await queryAll(env,`SELECT r.*,s.name AS seeker_name,s.email AS seeker_email,e.name AS event_name FROM registrations r JOIN seekers s ON s.id=r.seeker_id LEFT JOIN events e ON e.id=r.event_id WHERE r.voided_at IS NULL ORDER BY r.created_at DESC LIMIT 200`);
 const bookings=await queryAll(env,`SELECT b.*,tc.name AS trial_name,e.name AS event_name FROM bookings b JOIN trial_catalog tc ON tc.code=b.trial_code LEFT JOIN events e ON e.id=b.event_id WHERE b.voided_at IS NULL ORDER BY b.start_at`);
 const catalog=await queryAll<{code:string;name:string}>(env,'SELECT code,name FROM trial_catalog');
 const pending=await queryAll(env,'SELECT id,json_extract(draft,\'$.name\') AS name FROM member_profiles WHERE active=1 AND submitted_revision IS NOT NULL ORDER BY updated_at');
 const names=new Map(catalog.map(t=>[t.code,t.name]));
 return jsonResponse({registrations:registrations.map(r=>{
 let choices: {code:string;preferred_time?:string}[]=[];try{const parsed=JSON.parse(String(r.trial_intentions||'[]'));if(Array.isArray(parsed))choices=parsed;}catch{}
 return {...r,choices:choices.map(c=>({...c,name:names.get(c.code)||c.code})),bookings:bookings.filter(b=>b.registration_id===r.id)};
 }),pending_profiles:pending});
};
