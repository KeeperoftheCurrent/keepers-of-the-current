import{queryAll,type Env}from'../../lib/db';
import{jsonResponse}from'../../_middleware';
export const onRequestGet:PagesFunction<Env>=async({env,request})=>{
 const id=new URL(request.url).searchParams.get('id');
 const rows=await queryAll<{id:string;published:string;leadership:number}>(env,'SELECT id,published,leadership FROM member_profiles WHERE active=1 AND published IS NOT NULL'+(id?' AND id=?':'')+' ORDER BY leadership DESC,json_extract(published,\'$.name\')',...(id?[id]:[]));
 return jsonResponse({members:rows.map(r=>{const p=JSON.parse(r.published);return{id:r.id,...p,story:id?p.story:undefined,story_document:id?p.story_document:undefined,portrait:p.portrait?`/api/public/portrait?id=${encodeURIComponent(r.id)}`:'',leadership:!!r.leadership};})});
};
