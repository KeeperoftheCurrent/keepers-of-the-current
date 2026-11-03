import{queryAll,queryFirst,audit,type Env}from'../../lib/db';
import{jsonResponse}from'../../_middleware';
import{profile,ownsPortrait,type Member}from'../../lib/members';
import type{AdminContextData}from'./_middleware';
export const onRequestGet:PagesFunction<Env,string,AdminContextData>=async({env})=>{
 const members=await queryAll<Member & {email:string}>(env,'SELECT m.*,s.email FROM member_profiles m JOIN seekers s ON s.id=m.seeker_id ORDER BY (submitted_revision IS NOT NULL) DESC,updated_at DESC');
 return jsonResponse({members:members.map(m=>({...m,draft:JSON.parse(m.draft),published:m.published?JSON.parse(m.published):null}))});
};
export const onRequestPost:PagesFunction<Env,string,AdminContextData>=async context=>{
 const {request,env}=context;if(request.headers.get('Origin')!==new URL(request.url).origin)return jsonResponse({error:'Invalid origin.'},403);
 const raw=await request.text();if(raw.length>30000)return jsonResponse({error:'Request too large.'},413);
 try{
 const b=JSON.parse(raw);const actor=context.data.user.email;let id=b.id;
 if(b.action==='grant'){
  const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';const name=typeof b.name==='string'?b.name.trim():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200||!name||name.length>80)return jsonResponse({error:'Enter a character name and valid login email.'},400);
  const seekerId=crypto.randomUUID();id=crypto.randomUUID();const p=profile({name});
  await env.DB.batch([
   env.DB.prepare("INSERT INTO seekers(id,name,email,email_normalized,rings_pursued,created_at) SELECT ?,?,?,?,'[]',? WHERE NOT EXISTS(SELECT 1 FROM seekers WHERE email_normalized=?)").bind(seekerId,name,email,email,Math.floor(Date.now()/1000),email),
   env.DB.prepare('INSERT INTO member_profiles(id,seeker_id,draft,updated_at) SELECT ?,id,?,? FROM seekers WHERE email_normalized=? ORDER BY created_at,id LIMIT 1 ON CONFLICT(seeker_id) DO UPDATE SET active=1').bind(id,JSON.stringify(p),Date.now(),email)
  ]);
 }else{
  const m=await queryFirst<Member>(env,'SELECT * FROM member_profiles WHERE id=?',id);if(!m)return jsonResponse({error:'Member not found.'},404);
  if(b.revision!==m.revision)return jsonResponse({error:'This profile changed. Reload and review the latest draft.'},409);
  let sql='',params:unknown[]=[];
  if(b.action==='save'){
   const p=profile(b.profile);if(!await ownsPortrait(env,m.id,p.portrait))throw new Error('Invalid portrait.');
   sql='UPDATE member_profiles SET draft=?,revision=revision+1,submitted_revision=revision+1,updated_at=? WHERE id=? AND revision=?';params=[JSON.stringify(p),Date.now(),id,m.revision];
  }else if(b.action==='approve'){
   if(!m.active||m.submitted_revision!==m.revision)throw new Error('Review a submitted draft before publishing.');
   const p=profile(JSON.parse(m.draft));if(!p.introduction)throw new Error('An introduction is required.');
   sql='UPDATE member_profiles SET published=draft,leadership=?,submitted_revision=NULL,review_note=\'\',reviewed_at=?,updated_at=? WHERE id=? AND revision=? AND submitted_revision=revision';params=[b.leadership===true?1:0,Date.now(),Date.now(),id,m.revision];
  }else if(b.action==='return'){
   if(typeof b.note!=='string'||b.note.length>1000)throw new Error('Keep feedback under 1,000 characters.');
   sql='UPDATE member_profiles SET submitted_revision=NULL,review_note=?,updated_at=? WHERE id=? AND revision=?';params=[b.note,Date.now(),id,m.revision];
  }else if(b.action==='unpublish'||b.action==='suspend'){
   sql='UPDATE member_profiles SET published=NULL,submitted_revision=NULL,active=?,updated_at=? WHERE id=? AND revision=?';params=[b.action==='suspend'?0:m.active,Date.now(),id,m.revision];
  }else throw new Error('Unknown action.');
  const result=await env.DB.prepare(sql).bind(...params).run();if(!result.meta.changes)return jsonResponse({error:'The draft changed. Reload and review again.'},409);
 }
 await audit(env,{actor_email:actor,action:'member_'+b.action,target_type:'member',target_id:id});
 return jsonResponse({ok:true});
 }catch(e){return jsonResponse({error:e instanceof Error?e.message:'Unable to update member.'},400);}
};
