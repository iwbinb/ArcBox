import React,{useEffect,useRef,useState} from 'react';
import {api,checkWallet,ClientError,connectWallet,provider,signIn,type Audit,type Draft,type Invitation,type Member,type Page,type Revision,type Session,type Workspace} from './client';
import './workspace.css';

export function WorkspaceApp(){
  const [lang,setLang]=useState<'zh'|'en'>('zh');const t=(zh:string,en:string)=>lang==='zh'?zh:en;
  const [session,setSession]=useState<Session|null>(null),[spaces,setSpaces]=useState<Workspace[]>([]),[selected,setSelected]=useState('');
  const [drafts,setDrafts]=useState<Page<Draft>>({items:[],nextCursor:null}),[members,setMembers]=useState<Member[]>([]),[invitations,setInvitations]=useState<Invitation[]>([]),[audit,setAudit]=useState<Page<Audit>>({items:[],nextCursor:null});
  const [workspaceName,setWorkspaceName]=useState(''),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[tool,setTool]=useState('deliver'),[editing,setEditing]=useState<Draft|null>(null),[history,setHistory]=useState<Revision[]>([]);
  const [recipient,setRecipient]=useState(''),[role,setRole]=useState('viewer'),[sentInvites,setSentInvites]=useState<{id:string;recipient:string;role:string}[]>([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
  const epoch=useRef(0),sessionRef=useRef<Session|null>(null);
  const current=spaces.find(w=>w.id===selected),canEdit=current?.role==='owner'||current?.role==='editor';
  function clear(){sessionRef.current=null;setSession(null);setSpaces([]);setSelected('');setDrafts({items:[],nextCursor:null});setMembers([]);setInvitations([]);setAudit({items:[],nextCursor:null});setSentInvites([]);setEditing(null);setHistory([]);setTitle('');setDescription('');}
  function message(e:unknown){
    const code=e instanceof ClientError?e.code:(e as {code?:number})?.code===4001?'SIGNATURE_CANCELLED':'REQUEST_FAILED';
    const known:Record<string,[string,string]>={
      WALLET_REQUIRED:['请安装或解锁浏览器钱包。','Install or unlock a browser wallet.'],WRONG_CHAIN:['请切换到 Arc Testnet。','Switch to Arc Testnet.'],
      WALLET_CHANGED:['钱包或网络已变化，请重新登录。','Wallet or network changed. Sign in again.'],SIGNATURE_CANCELLED:['你已取消签名，没有发生交易。','Signature cancelled. No transaction was sent.'],
      VERSION_CONFLICT:['草稿已被其他人修改。当前输入已保留；点击“加载最新版本”后核对再保存。','Another editor saved a newer version. Your input is preserved. Load the latest version before saving.'],
      FORBIDDEN:['当前角色不能执行此操作。','Your role cannot perform this action.'],NOT_FOUND:['记录不存在或你已没有访问权限。','Record not found or access was removed.'],
      AUTH_REQUIRED:['请先登录。','Sign in first.'],SESSION_EXPIRED:['会话已过期，请重新登录。','Session expired. Sign in again.'],
      INVITATION_EXISTS:['此钱包已有待接受的邀请。','This wallet already has a pending invitation.'],INVITATION_UNAVAILABLE:['邀请已失效、已接受或不可用。','Invitation expired, accepted or unavailable.'],
      IDENTITY_DISABLED:['此环境未开放身份后台。','Identity is not enabled in this environment.'],INVALID_ADDRESS:['请输入有效的钱包地址。','Enter a valid wallet address.'],
      RATE_LIMITED:['请求过于频繁，请稍后再试。','Too many requests. Try again later.'],REQUEST_FAILED:['请求未完成，请重试。未确认的操作不代表已保存。','Request did not complete. Retry; unconfirmed changes are not saved.'],
    };
    setError(known[code]?.[lang==='zh'?0:1]??`${t('操作未完成','Action did not complete')}: ${code}`);
    if(e instanceof ClientError&&e.status===401){epoch.current++;clear();}
  }
  async function loadData(s:Session,preferred=selected){
    const ticket=epoch.current;
    const [ws,inv]=await Promise.all([api<Workspace[]>('/workspaces'),api<Invitation[]>('/invitations')]);
    if(ticket!==epoch.current)return;
    setSpaces(ws);setInvitations(inv);const choice=ws.find(w=>w.id===preferred)??ws[0];setSelected(choice?.id??'');
    if(!choice){setDrafts({items:[],nextCursor:null});setMembers([]);setAudit({items:[],nextCursor:null});return;}
    const base=`/workspaces/${choice.id}`;
    const [ds,ms,as,si]=await Promise.all([api<Page<Draft>>(base+'/drafts'),api<Member[]>(base+'/members'),api<Page<Audit>>(base+'/audit'),choice.role==='owner'?api<{id:string;recipient:string;role:string}[]>(base+'/invitations'):Promise.resolve([])]);
    if(ticket!==epoch.current||sessionRef.current?.user.id!==s.user.id)return;
    setDrafts(ds);setMembers(ms);setAudit(as);setSentInvites(si);
  }
  async function run(action:()=>Promise<void>){
    const ticket=epoch.current;setBusy(true);setError('');setNotice('');
    try{await action();}catch(e){if(ticket===epoch.current)message(e);}finally{setBusy(false);}
  }
  async function write<T>(path:string,method:string,data:unknown,version?:number):Promise<T>{
    const s=sessionRef.current;if(!s)throw new ClientError('AUTH_REQUIRED',401);
    try{await checkWallet(s);}catch(e){epoch.current++;clear();void api('/auth/logout','POST',{},s.csrfToken).catch(()=>{});throw e;}
    return api<T>(path,method,data,s.csrfToken,version);
  }
  async function connect(){
    await run(async()=>{
      const {address,p}=await connectWallet(),ticket=epoch.current;
      const result=await signIn(address,p);
      if(ticket!==epoch.current){await api('/auth/logout','POST',{},result.csrfToken);return;}
      await checkWallet(result);sessionRef.current=result;setSession(result);await loadData(result);
    });
  }
  async function signOut(){await run(async()=>{const s=sessionRef.current;if(s)await api('/auth/logout','POST',{},s.csrfToken);epoch.current++;clear();});}
  useEffect(()=>{
    let active=true;document.title='ArcBox | Workspace';
    const restore=async()=>{const ticket=epoch.current;try{const s=await api<Session>('/session');if(!active||ticket!==epoch.current)return;await checkWallet(s);sessionRef.current=s;setSession(s);await loadData(s);}catch(e){if(active&&!(e instanceof ClientError&&e.status===401))message(e);}finally{if(active)setReady(true);}};
    void restore();
    const invalidate=()=>{const old=sessionRef.current;epoch.current++;clear();setBusy(false);setError(t('钱包或网络已变化，请重新登录。','Wallet or network changed. Sign in again.'));if(old)void api('/auth/logout','POST',{},old.csrfToken).catch(()=>{});};
    const p=provider();p?.on?.('accountsChanged',invalidate);p?.on?.('chainChanged',invalidate);
    const focus=()=>{if(document.visibilityState==='visible'&&sessionRef.current)void restore();};document.addEventListener('visibilitychange',focus);
    return()=>{active=false;p?.removeListener?.('accountsChanged',invalidate);p?.removeListener?.('chainChanged',invalidate);document.removeEventListener('visibilitychange',focus);};
  },[]);
  useEffect(()=>{if(!session)return;const timeout=setTimeout(()=>{epoch.current++;clear();setError(t('会话已过期，请重新登录。','Session expired. Sign in again.'));},Math.max(0,session.expiresAt-Date.now()));return()=>clearTimeout(timeout);},[session?.expiresAt]);
  useEffect(()=>{const dirty=editing?title!==editing.title||description!==editing.description:Boolean(title||description);if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[title,description,editing]);
  const resetDraft=()=>{setEditing(null);setTitle('');setDescription('');setTool('deliver');setHistory([]);};
  const base=`/workspaces/${selected}`;
  return <main className="identity-app">
    <header><a href="/">ArcBox</a><button type="button" onClick={()=>setLang(lang==='zh'?'en':'zh')}>{lang==='zh'?'English':'中文'}</button></header>
    <p className="identity-boundary">M2-A · {t('身份与协作测试界面 · 无资金功能','Identity and collaboration test build · No payment capabilities')}</p>
    <h1>{t('工作区','Workspace')}</h1><p>{t('登录签名只用于验证身份，不授权付款，也不会发送链上交易。','A login signature proves identity. It does not authorize payments or send a transaction.')}</p>
    {error?<div role="alert" className="identity-error">{error}</div>:null}{notice?<p role="status">{notice}</p>:null}
    {!ready?<p role="status">{t('正在检查会话…','Checking session…')}</p>:null}
    {!session?<section className="identity-card"><h2>{t('连接测试钱包','Connect a test wallet')}</h2><p>{t('使用浏览器钱包和 Arc Testnet。不要输入私钥或助记词。','Use your browser wallet on Arc Testnet. Never enter a private key or recovery phrase.')}</p><button disabled={busy} type="button" onClick={()=>void connect()}>{busy?t('处理中…','Working…'):t('签名登录','Sign in with wallet')}</button></section>:<>
      <section className="identity-card identity-session"><span data-testid="session-address">{session.user.address}</span><span>{t('有效至','Valid until')} {new Date(session.expiresAt).toLocaleString()}</span><button disabled={busy} onClick={()=>void signOut()}>{t('退出登录','Sign out')}</button></section>
      {invitations.length?<section className="identity-card"><h2>{t('待接受邀请','Pending invitations')}</h2>{invitations.map(i=><div className="identity-row" key={i.id}><span>{i.name} · {i.role}</span><button disabled={busy} onClick={()=>void run(async()=>{await write(`/invitations/${i.id}/accept`,'POST',{});await loadData(session,i.workspace_id);})}>{t('接受邀请','Accept invitation')}</button></div>)}</section>:null}
      <section className="identity-card"><h2>{t('选择或创建工作区','Choose or create a workspace')}</h2>
        <label>{t('当前工作区','Current workspace')}<select aria-label={t('当前工作区','Current workspace')} value={selected} disabled={busy||!spaces.length} onChange={e=>{const next=e.target.value;resetDraft();void run(()=>loadData(session,next));}}><option value="">{t('请选择','Choose')}</option>{spaces.map(w=><option key={w.id} value={w.id}>{w.name} ({w.role})</option>)}</select></label>
        <form onSubmit={e=>{e.preventDefault();void run(async()=>{const w=await write<Workspace>('/workspaces','POST',{name:workspaceName});setWorkspaceName('');resetDraft();await loadData(session,w.id);});}}><label>{t('新工作区名称','New workspace name')}<input required maxLength={80} value={workspaceName} onChange={e=>setWorkspaceName(e.target.value)}/></label><button disabled={busy}>{t('创建工作区','Create workspace')}</button></form>
      </section>
      {current?<>
        <div className="identity-columns"><section className="identity-card"><h2>{t('草稿','Drafts')} · {current.role}</h2><p>{t('草稿不是订单，不生成收款链接或资金承诺。','Drafts are not orders and create no payment links or financial obligations.')}</p>
          {canEdit?<form onSubmit={e=>{e.preventDefault();void run(async()=>{const result=editing?await write<Draft>(base+'/drafts/'+editing.id,'PATCH',{title,description},editing.version):await write<Draft>(base+'/drafts','POST',{title,description,toolType:tool});setEditing(result);setNotice(t('草稿已保存到当前后台','Draft saved to the current backend'));await loadData(session);});}}>
            <label>{t('工具','Tool')}<select value={tool} disabled={Boolean(editing)} onChange={e=>setTool(e.target.value)}>{['deliver','group','split','attend','milestones','rewards'].map(v=><option value={v} key={v}>{v}</option>)}</select></label>
            <label>{t('草稿名称','Draft title')}<input required maxLength={80} value={title} onChange={e=>setTitle(e.target.value)}/></label>
            <label>{t('说明','Description')}<textarea maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
            <div className="identity-actions"><button disabled={busy}>{t('保存草稿','Save draft')}{editing?` · v${editing.version}`:''}</button><button type="button" disabled={busy} onClick={resetDraft}>{t('新建草稿','New draft')}</button>
              {editing?<button type="button" disabled={busy} onClick={()=>void run(async()=>{const d=await api<Draft>(base+'/drafts/'+editing.id);setEditing(d);setTitle(d.title);setDescription(d.description);setTool(d.tool_type);})}>{t('加载最新版本','Load latest version')}</button>:null}</div>
          </form>:<p>{t('当前角色只有只读权限。','Your current role is read-only.')}</p>}
          {!drafts.items.length?<p>{t('还没有草稿。','No drafts yet.')}</p>:null}
          {drafts.items.map(d=><article className="identity-item" key={d.id}><strong>{d.title}</strong><span>{d.tool_type} · v{d.version} {d.archived?t('· 已归档','· Archived'):''}</span><div className="identity-actions">
            {canEdit&&!d.archived?<button disabled={busy} onClick={()=>{setEditing(d);setTitle(d.title);setDescription(d.description);setTool(d.tool_type);setHistory([]);}}>{t('编辑','Edit')}</button>:null}
            <button disabled={busy} onClick={()=>void run(async()=>{setHistory((await api<Page<Revision>>(base+'/drafts/'+d.id+'/revisions')).items);})}>{t('版本记录','Revision history')}</button>
            {canEdit&&!d.archived?<button disabled={busy} onClick={()=>void run(async()=>{if(!window.confirm(t('归档后不能继续编辑，确定归档？','Archived drafts cannot be edited. Archive this draft?')))return;await write(base+'/drafts/'+d.id,'PATCH',{archived:true},d.version);resetDraft();await loadData(session);})}>{t('归档','Archive')}</button>:null}
          </div></article>)}
          {drafts.nextCursor?<button disabled={busy} onClick={()=>void run(async()=>{const next=await api<Page<Draft>>(base+'/drafts?cursor='+drafts.nextCursor);setDrafts({items:[...drafts.items,...next.items],nextCursor:next.nextCursor});})}>{t('更多草稿','More drafts')}</button>:null}
          {history.length?<aside><h3>{t('版本记录','Revision history')}</h3>{history.map(h=><p key={h.version}>v{h.version} · {h.title}</p>)}</aside>:null}
        </section><section className="identity-card"><h2>{t('成员与权限','Members and permissions')}</h2><p>{t('角色仅管理站内数据，不授予资金权限。所有者不可在此转移。','Roles control application data, not funds. Ownership cannot be transferred here.')}</p>
          {members.map(m=><div className="identity-item" key={m.user_id}><span>{m.address}</span>{current.role==='owner'&&m.role!=='owner'?<div className="identity-actions"><select aria-label={t('成员角色','Member role')+' '+m.address} value={m.role} disabled={busy} onChange={e=>{const value=e.target.value;void run(async()=>{await write(base+'/members/'+encodeURIComponent(m.user_id),'PATCH',{role:value});await loadData(session);});}}>{['editor','operator','viewer'].map(v=><option key={v}>{v}</option>)}</select><button disabled={busy} onClick={()=>void run(async()=>{if(!window.confirm(t('移除该成员的访问权限？','Remove this member’s access?')))return;await write(base+'/members/'+encodeURIComponent(m.user_id),'DELETE',{});await loadData(session);})}>{t('移除','Remove')}</button></div>:<strong>{m.role}</strong>}</div>)}
          {current.role==='owner'?<form onSubmit={e=>{e.preventDefault();void run(async()=>{await write(base+'/invitations','POST',{address:recipient,role});setRecipient('');setNotice(t('邀请已创建，需目标钱包登录接受','Invitation created; the target wallet must sign in and accept'));await loadData(session);});}}>
            <label>{t('邀请钱包地址','Invite wallet address')}<input required value={recipient} onChange={e=>setRecipient(e.target.value)}/></label><label>{t('邀请角色','Invitation role')}<select value={role} onChange={e=>setRole(e.target.value)}>{['viewer','operator','editor'].map(v=><option key={v}>{v}</option>)}</select></label><button disabled={busy}>{t('创建邀请','Create invitation')}</button>
          </form>:null}
          {sentInvites.map(i=><div className="identity-item" key={i.id}><span>{t('待接受','Pending')}: {i.recipient} · {i.role}</span><button disabled={busy} onClick={()=>void run(async()=>{await write(base+'/invitations/'+i.id,'DELETE',{});await loadData(session);})}>{t('撤销邀请','Revoke invitation')}</button></div>)}
        </section></div>
        <section className="identity-card"><h2>{t('操作记录','Activity log')}</h2><p>{t('记录身份与协作操作，不包含私钥、签名或会话令牌。','Identity and collaboration events, without private keys, signatures or session tokens.')}</p>{audit.items.map(a=><p className="identity-log" key={a.id}>{a.action} {a.version?`· v${a.version}`:''} <time>{new Date(a.created_at).toLocaleString()}</time></p>)}{audit.nextCursor?<button disabled={busy} onClick={()=>void run(async()=>{const next=await api<Page<Audit>>(base+'/audit?cursor='+audit.nextCursor);setAudit({items:[...audit.items,...next.items],nextCursor:next.nextCursor});})}>{t('更早记录','Older events')}</button>:null}</section>
      </>:null}
    </>}
  </main>;
}
