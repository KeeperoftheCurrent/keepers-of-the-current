import{queryAll,queryFirst,audit,type Env}from'../../lib/db';import{jsonResponse}from'../../_middleware';import type{AdminContextData}from'./_middleware';
export const onRequestGet:PagesFunction<Env>=async({env})=>jsonResponse({entries:(await queryAll<{draft:string;published:string|null}>(env,'SELECT * FROM chronicles ORDER BY updated_at DESC')).map(r=>({...r,draft:JSON.parse(r.draft),published:r.published?JSON.parse(r.published):null}))});
export const onRequestPost:PagesFunction<Env,string,AdminContextData>=async({env,request,data})=>{
 if(request.headers.get('Origin')!==new URL(request.url).origin)return jsonResponse({error:'Invalid origin.'},403);
 const raw=await request.text();if(raw.length>40000)return jsonResponse({error:'Entry too long.'},413);
 try{const b=JSON.parse(raw);const id=b.id||crypto.randomUUID();const row=await queryFirst<{revision:number}>(env,'SELECT revision FROM chronicles WHERE id=?',id);
 if(row&&row.revision!==b.revision)return jsonResponse({error:'This entry changed. Reload before saving.'},409);
 if(b.action==='save'){
 const p:Record<string,string>={};for(const[k,max]of Object.entries({title:160,date:10,summary:300,body:24000,author:100,source:500,video:11})){const v=b.entry?.[k]??'';if(typeof v!=='string'||v.length>max)throw new Error('Check the '+k+' field.');p[k]=v.trim();}
 if(!p.title||!p.summary||!p.body||!/^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(p.date))throw new Error('Add a title, summary, story and date (YYYY-MM or YYYY-MM-DD).');
 if(p.source&&(!p.source.startsWith('https://')||new URL(p.source).username||new URL(p.source).password))throw new Error('Use an HTTPS source link.');if(p.video&&!/^[A-Za-z0-9_-]{11}$/.test(p.video))throw new Error('Enter an 11-character YouTube video ID.');
 if(row){const r=await env.DB.prepare('UPDATE chronicles SET draft=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(p),Date.now(),id,row.revision).run();if(!r.meta.changes)return jsonResponse({error:'Entry changed. Reload.'},409);}
 else await env.DB.prepare('INSERT INTO chronicles(id,draft,updated_at) VALUES(?,?,?)').bind(id,JSON.stringify(p),Date.now()).run();
 }else if((b.action==='publish'||b.action==='hide')&&row){const r=await env.DB.prepare('UPDATE chronicles SET published='+ (b.action==='publish'?'draft':'NULL') +',updated_at=? WHERE id=? AND revision=?').bind(Date.now(),id,row.revision).run();if(!r.meta.changes)return jsonResponse({error:'Entry changed. Reload.'},409);
 }else throw new Error('Save your entry first.');
 await audit(env,{actor_email:data.user.email,action:'chronicle_'+b.action,target_type:'chronicle',target_id:id});return jsonResponse({ok:true,id});
 }catch(e){return jsonResponse({error:e instanceof Error?e.message:'Unable to save entry.'},400);}
};
