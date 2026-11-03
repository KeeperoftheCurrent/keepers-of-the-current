import { queryFirst, type Env } from './db';
import { authenticateSeeker } from './seeker-auth';
import { jsonResponse } from '../_middleware';
export interface Profile { name:string; introduction:string; story:string; current_role:string; hynafol_title:string; honours:string; affiliations:string; portrait:string; source:string; }
export interface Member { id:string; seeker_id:string; active:number; draft:string; published:string|null; revision:number; submitted_revision:number|null; review_note:string; leadership:number; }
export const limits = {name:80,introduction:240,story:16000,current_role:120,hynafol_title:160,honours:240,affiliations:200,portrait:100,source:500};
export function profile(input: unknown): Profile {
 if(!input || typeof input !== 'object') throw new Error('Please complete your character details.');
 const out:Record<string,string>={};
 for(const [key,max] of Object.entries(limits)) {
  const val=(input as Record<string,unknown>)[key] ?? '';
  if(typeof val!=='string'||val.length>max) throw new Error(`${key.replaceAll('_',' ')} is too long.`);
  out[key]=val.trim();
 }
 if(out.source&&(!out.source.startsWith('https://')||new URL(out.source).username||new URL(out.source).password))throw new Error('Use an HTTPS story source.');
 if(!out.name) throw new Error('Your character needs a name.');
 return out as unknown as Profile;
}
export async function ownsPortrait(env:Env,id:string,portrait:string) {
 return !portrait || portrait==='/assets/img/talia-editorial-v2.jpg' || !!await queryFirst(env,'SELECT id FROM member_portraits WHERE id=? AND member_id=?',portrait,id);
}
export async function memberSession(context:EventContext<Env,string,unknown>) {
 const request=new Request(context.request.url,{method:'POST',headers:context.request.headers,body:JSON.stringify({action:'session'})});
 const auth=await authenticateSeeker({...context,request:request as typeof context.request});
 if(auth instanceof Response)return auth;
 const m=await queryFirst<Member>(context.env,'SELECT * FROM member_profiles WHERE seeker_id=? AND active=1',auth.seekerId);
 return m ?? jsonResponse({error:'Your character page awaits the Keeper’s membership approval. Please speak with a leader at Keepers Rest.'},403);
}
// Only bounded JPEGs are accepted. Strip all APP/COM metadata, including EXIF/GPS,
// between scans too. Never serve submitted HTML, SVG or trailing data.
export function cleanPortrait(data:unknown):string {
 if(typeof data!=='string'||data.length>280000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data))throw new Error('Choose a JPEG portrait under 200 KB after cropping.');
 const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));
 if(bytes.length>200000||bytes[0]!==255||bytes[1]!==216)throw new Error('Invalid portrait.');
 const output:number[]=[255,216]; let i=2,frame=false,scan=false,ended=false;
 while(i<bytes.length){
  if(bytes[i]!==255)throw new Error('Invalid JPEG marker.');
  const start=i++;while(bytes[i]===255)i++;const marker=bytes[i++];
  if(marker===217){output.push(255,217);ended=true;break;}
  if(marker===216||marker===0)throw new Error('Invalid JPEG.');
  const length=(bytes[i]<<8)|bytes[i+1];if(length<2||i+length>bytes.length)throw new Error('Incomplete JPEG.');
  if(marker===192||marker===194){const height=(bytes[i+3]<<8)|bytes[i+4],width=(bytes[i+5]<<8)|bytes[i+6];if(width<1||height<1||width>800||height>800)throw new Error('Crop your portrait to 800 pixels or smaller.');frame=true;}
  if(!(marker>=224&&marker<=239)&&marker!==254)for(let j=start;j<i+length;j++)output.push(bytes[j]);
  i+=length;
  if(marker===218){scan=true;const from=i;while(i<bytes.length){if(bytes[i]===255&&bytes[i+1]!==0&&!(bytes[i+1]>=208&&bytes[i+1]<=215))break;i+=bytes[i]===255?2:1;}for(let j=from;j<i;j++)output.push(bytes[j]);}
 }
 if(!frame||!scan||!ended)throw new Error('Incomplete JPEG portrait.');
 let binary='';for(const byte of output)binary+=String.fromCharCode(byte);return btoa(binary);
}
