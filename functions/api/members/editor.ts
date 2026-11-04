import { queryFirst,exec,type Env } from '../../lib/db';
import {jsonResponse} from '../../_middleware';
import{memberSession,profile,ownsPortrait,cleanPortrait}from'../../lib/members';
export const onRequestPost:PagesFunction<Env>=async context=>{
 const member=await memberSession(context);if(member instanceof Response)return member;
 if(Number(context.request.headers.get('content-length'))>1600000)return jsonResponse({error:'Upload is too large.'},413);
 const raw=await context.request.text();if(raw.length>1600000)return jsonResponse({error:'Upload is too large.'},413);
 try{
 const b=JSON.parse(raw);const env=context.env;
 if(b.action==='load'){
  const draft=JSON.parse(member.draft), portrait=draft.portrait?await queryFirst<{jpeg:string}>(env,'SELECT jpeg FROM member_portraits WHERE id=? AND member_id=?',draft.portrait,member.id):null;
  return jsonResponse({member:{id:member.id,draft,revision:member.revision,submitted:member.submitted_revision!==null,has_published:!!member.published,review_note:member.review_note,portrait_data:portrait?'data:image/jpeg;base64,'+portrait.jpeg:null}});
 }
 if(b.action==='withdraw'){
  await exec(env,'UPDATE member_profiles SET published=NULL,submitted_revision=NULL,updated_at=? WHERE id=?',Date.now(),member.id);
  return jsonResponse({ok:true});
 }
 if(b.action!=='save'&&b.action!=='submit')return jsonResponse({error:'Unknown action.'},400);
 if(b.revision!==member.revision)return jsonResponse({error:'Your page changed in another window. Reload before saving.'},409);
 const draft=profile(b.profile);
 if(!await ownsPortrait(env,member.id,draft.portrait))return jsonResponse({error:'Choose your own portrait.'},400);
 if(b.action==='submit'&&(!draft.introduction||b.consent!==true))return jsonResponse({error:'Add an introduction and confirm you want this profile published.'},400);
 let portraitId='';let jpeg='';
 if(b.portrait_data){jpeg=cleanPortrait(b.portrait_data);portraitId=crypto.randomUUID();draft.portrait=portraitId;}
 const now=Date.now();
 const statements=[];
 if(portraitId)statements.push(env.DB.prepare('INSERT INTO member_portraits(id,member_id,jpeg,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM member_profiles WHERE id=? AND revision=? AND active=1)').bind(portraitId,member.id,jpeg,now,member.id,b.revision));
 statements.push(env.DB.prepare('UPDATE member_profiles SET draft=?,revision=revision+1,submitted_revision=?,review_note=\'\',updated_at=? WHERE id=? AND revision=? AND active=1').bind(JSON.stringify(draft),b.action==='submit'?member.revision+1:null,now,member.id,b.revision));
 const results=await env.DB.batch(statements);if(!results.at(-1)?.meta.changes)return jsonResponse({error:'Your page changed. Reload before saving.'},409);
 // Keep only the current draft and published portraits; bound storage per member.
 await exec(env,`DELETE FROM member_portraits WHERE member_id=? AND id NOT IN (SELECT COALESCE(json_extract(draft,'$.portrait'),'') FROM member_profiles WHERE id=? UNION SELECT COALESCE(json_extract(published,'$.portrait'),'') FROM member_profiles WHERE id=?)`,member.id,member.id,member.id);
 return jsonResponse({ok:true,revision:member.revision+1,portrait:draft.portrait});
 }catch(e){return jsonResponse({error:e instanceof Error?e.message:'Please check your profile.'},400);}
};
