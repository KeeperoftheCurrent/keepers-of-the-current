import type { Env } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import type { AdminContextData } from './_middleware';
export const onRequestGet: PagesFunction<Env,string,AdminContextData> = async ({request,data}) => {
 if(new URL(request.url).searchParams.get('enter')==='1')return new Response(null,{status:302,headers:{Location:'/admin','Cache-Control':'no-store'}});
 return jsonResponse({email:data.user.email});
};
