import{queryFirst,type Env}from'../../lib/db';import{jsonResponse}from'../../_middleware';
export const onRequestGet:PagesFunction<Env>=async({request,env})=>{
 const id=new URL(request.url).searchParams.get('id');const p=await queryFirst<{jpeg:string}>(env,"SELECT p.jpeg FROM member_portraits p JOIN member_profiles m ON p.member_id=m.id AND p.id=json_extract(m.draft,'$.portrait') WHERE m.id=?",id);
 return jsonResponse({data:p?'data:image/jpeg;base64,'+p.jpeg:null});
};
