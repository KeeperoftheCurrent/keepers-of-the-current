import{queryFirst,type Env}from'../../lib/db';
export const onRequestGet:PagesFunction<Env>=async({env,request})=>{
 const id=new URL(request.url).searchParams.get('id');
 const m=await queryFirst<{portrait:string}>(env,"SELECT json_extract(published,'$.portrait') portrait FROM member_profiles WHERE id=? AND active=1 AND published IS NOT NULL",id);
 if(!m?.portrait)return new Response('Not found',{status:404});
 if(m.portrait==='/assets/img/talia-editorial-v2.jpg')return Response.redirect(new URL(m.portrait,request.url).href,302);
 const p=await queryFirst<{jpeg:string}>(env,'SELECT jpeg FROM member_portraits WHERE id=? AND member_id=?',m.portrait,id);
 if(!p)return new Response('Not found',{status:404});
 return new Response(Uint8Array.from(atob(p.jpeg),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
};
