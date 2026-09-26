import type { Identity } from './auth';
import { address, bad, body, expectedVersion, response, text, type IdentityEnv } from './security';

type Role='owner'|'editor'|'operator'|'viewer';
interface Membership {role:Role}
const roles=['editor','operator','viewer'];
const tools=['deliver','group','split','attend','milestones','rewards'];
const uuid=()=>crypto.randomUUID();
const userExists="EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=?1 AND m.user_id=?2)";
export async function member(db:D1Database,workspace:string,user:string,allowed?:readonly string[]):Promise<Role>{
  const row=await db.prepare('SELECT role FROM memberships WHERE workspace_id=?1 AND user_id=?2').bind(workspace,user).first<Membership>();
  if(!row)return bad(404,'NOT_FOUND');
  if(allowed&&!allowed.includes(row.role))return bad(403,'FORBIDDEN');
  return row.role;
}
function role(value:unknown):string{if(typeof value!=='string'||!roles.includes(value))return bad(422,'INVALID_ROLE');return value;}
function page(request:Request):string{const cursor=new URL(request.url).searchParams.get('cursor')??'';if(cursor.length>100)return bad(422,'INVALID_CURSOR');return cursor;}
function changed(result:D1Result):void{
  // RETURNING counts the intended row, independently of audit/revision triggers.
  if(result.results.length!==1)bad(409,'STATE_CHANGED');
}
export async function workspaceRoutes(request:Request,env:IdentityEnv,identity:Identity,parts:string[]):Promise<Response>{
  const db=env.DB,user=identity.userId,now=Date.now(),method=request.method;
  if(parts[0]==='invitations'){
    if(parts.length===1&&method==='GET'){
      const rows=await db.prepare("SELECT i.id,i.workspace_id,w.name,i.role,i.expires_at FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.recipient=?1 AND i.state='pending' AND i.expires_at>?2 ORDER BY i.id LIMIT 100").bind(identity.address.toLowerCase(),now).all();
      return response(rows.results);
    }
    if(parts.length===3&&parts[2]==='accept'&&method==='POST'){
      await body(request,[]);
      const row=await db.prepare("UPDATE invitations SET state='accepted',accepted_by=?1,updated_by=?1,updated_at=?2 WHERE id=?3 AND recipient=?4 AND state='pending' AND expires_at>?2 AND NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=invitations.workspace_id AND user_id=?1) AND (SELECT count(*) FROM memberships WHERE user_id=?1)<50 AND (SELECT count(*) FROM memberships WHERE workspace_id=invitations.workspace_id)<100 RETURNING workspace_id").bind(user,now,parts[1]!,identity.address.toLowerCase()).first<{workspace_id:string}>();
      if(!row)return bad(409,'INVITATION_UNAVAILABLE');
      return response({workspaceId:row.workspace_id});
    }
    return bad(404,'NOT_FOUND');
  }
  if(parts[0]!=='workspaces')return bad(404,'NOT_FOUND');
  if(parts.length===1){
    if(method==='GET'){
      const rows=await db.prepare('SELECT w.id,w.name,w.version,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=?1 ORDER BY w.id LIMIT 50').bind(user).all();
      return response(rows.results);
    }
    if(method==='POST'){
      const input=await body(request,['name']),name=text(input.name,80),id=uuid();
      const row=await db.prepare('INSERT INTO workspaces(id,name,owner_id,created_at,updated_at,updated_by) SELECT ?1,?2,?3,?4,?4,?3 WHERE (SELECT count(*) FROM memberships WHERE user_id=?3)<50 RETURNING id').bind(id,name,user,now).first();
      if(!row)return bad(409,'WORKSPACE_LIMIT');
      return response({id,name,version:1,role:'owner'},201);
    }
    return bad(404,'NOT_FOUND');
  }
  const workspace=parts[1]!;
  const currentRole=await member(db,workspace,user);
  const owner=()=>{if(currentRole!=='owner')bad(403,'FORBIDDEN');};
  const editor=()=>{if(!['owner','editor'].includes(currentRole))bad(403,'FORBIDDEN');};
  if(parts.length===2){
    if(method==='GET')return response(await db.prepare(`SELECT id,name,version FROM workspaces WHERE id=?1 AND ${userExists}`).bind(workspace,user).first());
    if(method==='PATCH'){
      owner();const input=await body(request,['name']),version=expectedVersion(request);
      const row=await db.prepare('UPDATE workspaces SET name=?1,version=version+1,updated_at=?2,updated_by=?3 WHERE id=?4 AND owner_id=?3 AND version=?5 RETURNING id,name,version').bind(text(input.name,80),now,user,workspace,version).first();
      if(!row)return bad(409,'VERSION_CONFLICT');return response(row,200,{'ETag':`"${version+1}"`});
    }
  }
  if(parts[2]==='members'){
    if(parts.length===3&&method==='GET')return response((await db.prepare('SELECT m.user_id,u.address,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?1 ORDER BY m.user_id LIMIT 100').bind(workspace).all()).results);
    if(parts.length===4&&(method==='PATCH'||method==='DELETE')){
      owner();let target:string;try{target=decodeURIComponent(parts[3]!);}catch{return bad(400,'INVALID_PATH');}
      if(target===user)return bad(409,'OWNER_IMMUTABLE');
      if(method==='PATCH'){
        const input=await body(request,['role']);
        changed(await db.prepare("UPDATE memberships SET role=?1,updated_by=?2,updated_at=?3 WHERE workspace_id=?4 AND user_id=?5 AND role!='owner' AND EXISTS(SELECT 1 FROM workspaces WHERE id=?4 AND owner_id=?2) RETURNING user_id").bind(role(input.role),user,now,workspace,target).run());
      }else{
        await body(request,[]);
        // Invalidate old invitations atomically with removal. Workspace ownership
        // is immutable in M2-A; the SQL still independently checks the actor.
        const statements=[
          db.prepare("UPDATE invitations SET state='revoked',updated_by=?1,updated_at=?2 WHERE workspace_id=?3 AND state='pending' AND recipient=(SELECT address FROM users WHERE id=?4) AND EXISTS(SELECT 1 FROM workspaces WHERE id=?3 AND owner_id=?1)").bind(user,now,workspace,target),
          db.prepare("INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,created_at) SELECT ?1,?2,'member.removed',?3,?4 WHERE EXISTS(SELECT 1 FROM memberships WHERE workspace_id=?1 AND user_id=?3 AND role!='owner') AND EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND owner_id=?2)").bind(workspace,user,target,now),
          db.prepare("DELETE FROM memberships WHERE workspace_id=?1 AND user_id=?2 AND role!='owner' AND EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND owner_id=?3) RETURNING user_id").bind(workspace,target,user),
        ];
        const result=await db.batch(statements);changed(result[2]!);
      }
      return response({updated:true});
    }
  }
  if(parts[2]==='invitations'){
    owner();
    if(parts.length===3&&method==='GET')return response((await db.prepare("SELECT id,recipient,role,state,expires_at FROM invitations WHERE workspace_id=?1 AND state='pending' AND expires_at>?2 ORDER BY id LIMIT 100").bind(workspace,now).all()).results);
    if(parts.length===3&&method==='POST'){
      const input=await body(request,['address','role']),recipient=address(input.address).toLowerCase(),newRole=role(input.role),id=uuid();
      if(recipient===identity.address.toLowerCase())bad(409,'OWNER_IMMUTABLE');
      try{
        const results=await db.batch([
          db.prepare("UPDATE invitations SET state='expired',updated_at=?1,updated_by=?2 WHERE workspace_id=?3 AND recipient=?4 AND state='pending' AND expires_at<=?1 AND EXISTS(SELECT 1 FROM workspaces WHERE id=?3 AND owner_id=?2)").bind(now,user,workspace,recipient),
          db.prepare("INSERT INTO invitations(id,workspace_id,recipient,role,expires_at,created_at,updated_at,updated_by) SELECT ?1,?2,?3,?4,?5,?6,?6,?7 WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=?2 AND owner_id=?7) AND NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?2 AND u.address=?3) AND (SELECT count(*) FROM invitations WHERE workspace_id=?2 AND state='pending' AND expires_at>?6)<100 RETURNING id").bind(id,workspace,recipient,newRole,now+7*86400000,now,user),
        ]);changed(results[1]!);
      }catch(error){if(String(error).includes('UNIQUE constraint'))return bad(409,'INVITATION_EXISTS');throw error;}
      return response({id,recipient,role:newRole,expiresAt:now+7*86400000},201);
    }
    if(parts.length===4&&method==='DELETE'){
      await body(request,[]);
      changed(await db.prepare("UPDATE invitations SET state='revoked',updated_at=?1,updated_by=?2 WHERE id=?3 AND workspace_id=?4 AND state='pending' AND EXISTS(SELECT 1 FROM workspaces WHERE id=?4 AND owner_id=?2) RETURNING id").bind(now,user,parts[3]!,workspace).run());
      return response({revoked:true});
    }
  }
  if(parts[2]==='drafts'){
    if(parts.length===3&&method==='GET'){
      const rows=(await db.prepare('SELECT id,tool_type,title,description,version,archived FROM drafts WHERE workspace_id=?1 AND id>?2 ORDER BY id LIMIT 51').bind(workspace,page(request)).all()).results;
      return response({items:rows.slice(0,50),nextCursor:rows.length>50?rows[49]!.id:null});
    }
    if(parts.length===3&&method==='POST'){
      editor();const input=await body(request,['toolType','title','description']);
      if(typeof input.toolType!=='string'||!tools.includes(input.toolType))return bad(422,'INVALID_TOOL');
      const title=text(input.title,80),description=text(input.description??'',2000,0),id=uuid();
      const row=await db.prepare("INSERT INTO drafts(id,workspace_id,tool_type,title,description,created_at,updated_at,updated_by) SELECT ?1,?2,?3,?4,?5,?6,?6,?7 WHERE EXISTS(SELECT 1 FROM memberships WHERE workspace_id=?2 AND user_id=?7 AND role IN ('owner','editor')) AND (SELECT count(*) FROM drafts WHERE workspace_id=?2)<500 RETURNING id").bind(id,workspace,input.toolType,title,description,now,user).first();
      if(!row)return bad(409,'DRAFT_LIMIT_OR_ACCESS_CHANGED');
      return response({id,tool_type:input.toolType,title,description,version:1,archived:0},201,{'ETag':'"1"'});
    }
    if(parts.length<4)return bad(404,'NOT_FOUND');
    const draftId=parts[3]!;
    const existing=await db.prepare('SELECT id,tool_type,title,description,version,archived FROM drafts WHERE id=?1 AND workspace_id=?2').bind(draftId,workspace).first<{id:string;tool_type:string;title:string;description:string;version:number;archived:number}>();
    if(!existing)return bad(404,'NOT_FOUND');
    if(parts.length===4&&method==='GET')return response(existing,200,{'ETag':`"${existing.version}"`});
    if(parts.length===4&&method==='PATCH'){
      editor();const input=await body(request,['title','description','archived']),version=expectedVersion(request);
      if(input.archived!==undefined&&input.archived!==true)return bad(422,'INVALID_FIELD');
      const title=input.title===undefined?existing.title:text(input.title,80),description=input.description===undefined?existing.description:text(input.description,2000,0);
      const row=await db.prepare("UPDATE drafts SET title=?1,description=?2,archived=?3,version=version+1,updated_at=?4,updated_by=?5 WHERE id=?6 AND workspace_id=?7 AND version=?8 AND archived=0 AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=?7 AND user_id=?5 AND role IN ('owner','editor')) RETURNING id,tool_type,title,description,version,archived").bind(title,description,input.archived===true?1:0,now,user,draftId,workspace,version).first();
      if(!row){await member(db,workspace,user,['owner','editor']);return bad(409,'VERSION_CONFLICT');}
      return response(row,200,{'ETag':`"${version+1}"`});
    }
    if(parts.length===5&&parts[4]==='revisions'&&method==='GET'){
      const cursor=page(request);if(cursor&&!/^[0-9]{1,9}$/.test(cursor))return bad(422,'INVALID_CURSOR');
      const rows=(await db.prepare('SELECT version,title,description,archived,actor_id,created_at FROM draft_revisions WHERE draft_id=?1 AND version<?2 ORDER BY version DESC LIMIT 51').bind(draftId,cursor?Number(cursor):1000000000).all()).results;
      return response({items:rows.slice(0,50),nextCursor:rows.length>50?rows[49]!.version:null});
    }
  }
  if(parts.length===3&&parts[2]==='audit'&&method==='GET'){
    const cursor=page(request);if(cursor&&!/^[0-9]{1,15}$/.test(cursor))return bad(422,'INVALID_CURSOR');
    const rows=(await db.prepare('SELECT id,actor_id,action,entity_id,version,created_at FROM audit_logs WHERE workspace_id=?1 AND id<?2 ORDER BY id DESC LIMIT 51').bind(workspace,cursor?Number(cursor):Number.MAX_SAFE_INTEGER).all()).results;
    return response({items:rows.slice(0,50),nextCursor:rows.length>50?rows[49]!.id:null});
  }
  return bad(404,'NOT_FOUND');
}
