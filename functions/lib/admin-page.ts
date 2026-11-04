import {onRequest as authenticateAdmin, type AdminContextData} from '../api/admin/_middleware';
import type {Env} from './db';
export const adminPage:PagesFunction<Env,string,AdminContextData>=async context=>{
 const result=await authenticateAdmin({...context,next:async()=>{
  const response=await context.next();
  response.headers.set('Cache-Control','private, no-store');
  response.headers.set('X-Robots-Tag','noindex, nofollow');
  return response;
 }});
 if(result.status===401)return new Response(null,{status:302,headers:{Location:'/api/admin/session?enter=1','Cache-Control':'no-store'}});
 return result;
};
