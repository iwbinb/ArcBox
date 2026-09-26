import { authenticate, challenge, login, logout, sessionResponse } from './auth';
import { ApiError, bad, checkOrigin, configuration, response, type IdentityEnv } from './security';
import { workspaceRoutes } from './workspaces';

export default {
  async fetch(request:Request,env:IdentityEnv):Promise<Response>{
    const requestId=crypto.randomUUID();
    try{
      const path=new URL(request.url).pathname;
      if(path==='/api/health')return response({stage:'M2-A',environment:env.APP_ENV,paymentsEnabled:false,identityEnabled:env.AUTH_ENABLED==='true'&&['local','testnet'].includes(env.APP_ENV)});
      if(path==='/api'||path.startsWith('/api/')){
        configuration(env);
        if(new URL(request.url).origin!==env.APP_ORIGIN)bad(403,'ORIGIN_MISMATCH');
        if(request.headers.get('Sec-Fetch-Site')==='cross-site')bad(403,'ORIGIN_MISMATCH');
        if(!['GET','POST','PATCH','DELETE'].includes(request.method))bad(405,'METHOD_NOT_ALLOWED');
        const mutating=request.method!=='GET';if(mutating)checkOrigin(request,env);
        let result:Response;
        if(path==='/api/v1/auth/nonce'&&request.method==='POST')result=await challenge(request,env);
        else if(path==='/api/v1/auth/verify'&&request.method==='POST')result=await login(request,env);
        else if(path==='/api/v1/session'&&request.method==='GET')result=sessionResponse(await authenticate(request,env));
        else if(path==='/api/v1/auth/logout'&&request.method==='POST')result=await logout(env,await authenticate(request,env,true));
        else{
          if(!/^\/api\/v1\/(workspaces|invitations)(\/|$)/.test(path))bad(404,'NOT_FOUND');
          const identity=await authenticate(request,env,mutating);
          result=await workspaceRoutes(request,env,identity,path.slice('/api/v1/'.length).split('/'));
        }
        result.headers.set('X-Request-Id',requestId);return result;
      }
      if(request.method!=='GET'&&request.method!=='HEAD')bad(405,'METHOD_NOT_ALLOWED');
      if(!env.ASSETS)return new Response('ArcBox identity local API',{headers:{'Cache-Control':'no-store'}});
      return env.ASSETS.fetch(request);
    }catch(error){
      const known=error instanceof ApiError;
      // Never serialize SQL errors, signed messages, cookies or provider bodies.
      return Response.json({error:{code:known?error.code:'INTERNAL_ERROR',requestId}}, {status:known?error.status:500,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId,...(known&&error.status===429?{'Retry-After':'60'}:{})}});
    }
  },
};
