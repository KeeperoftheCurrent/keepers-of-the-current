import{queryAll,type Env}from'../../lib/db';import{jsonResponse}from'../../_middleware';
export const onRequestGet:PagesFunction<Env>=async({env,request})=>{
 const id=new URL(request.url).searchParams.get('id');const rows=await queryAll<{id:string;published:string}>(env,'SELECT id,published FROM chronicles WHERE published IS NOT NULL'+(id?' AND id=?':'')+" ORDER BY json_extract(published,'$.date') DESC,id",...(id?[id]:[]));
 return jsonResponse({entries:rows.map(r=>{const p=JSON.parse(r.published);return{id:r.id,...p,body:id?p.body:undefined};})});
};
