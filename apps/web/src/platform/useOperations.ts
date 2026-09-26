import {useEffect,useRef,useState} from 'react';
import {api,checkWallet,ClientError,connectWallet,provider,signIn,type Page,type Session,type Workspace} from '../identity/client';
import type {ActivityItem,CatalogItem,DownloadGrant,FileItem,JobItem,NotificationItem,Operations,Recovery} from './types';
export type Tab='files'|'jobs'|'notifications'|'activity'|'recovery';
const empty=<T,>():Page<T>=>({items:[],nextCursor:null});

export function useOperations(){
  const [lang,setLang]=useState<'zh'|'en'>('zh'),[session,setSession]=useState<Session|null>(null),[spaces,setSpaces]=useState<Workspace[]>([]),[wid,setWid]=useState('');
  const [tab,setTab]=useState<Tab>('files'),[files,setFiles]=useState<Page<FileItem>>(empty),[jobs,setJobs]=useState<Page<JobItem>>(empty),[notes,setNotes]=useState<Page<NotificationItem>>(empty),[activity,setActivity]=useState<Page<ActivityItem>>(empty);
  const [catalog,setCatalog]=useState<CatalogItem[]>([]),[catalogId,setCatalogId]=useState('sample-v1'),[series,setSeries]=useState(''),[ops,setOps]=useState<Operations|null>(null),[recovery,setRecovery]=useState<Recovery|null>(null),[orderId,setOrderId]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  const epoch=useRef(0),loads=useRef(0),sessionRef=useRef<Session|null>(null),pendingUpload=useRef<{key:string;workspaceId:string;catalogId:string;seriesId:string}|null>(null);
  const logoutPending=useRef<Promise<unknown>>(Promise.resolve());
  const t=(zh:string,en:string)=>lang==='zh'?zh:en;
  const current=spaces.find(s=>s.id===wid),edit=current?.role==='owner'||current?.role==='editor',operate=current?.role==='owner'||current?.role==='operator';
  const date=(n:number)=>new Date(n).toLocaleString(lang==='zh'?'zh-CN':'en-US');
  function clear(){
    epoch.current++;loads.current++;sessionRef.current=null;pendingUpload.current=null;
    setSession(null);setSpaces([]);setWid('');setFiles(empty());setJobs(empty());setNotes(empty());setActivity(empty());setRecovery(null);setOps(null);setCatalog([]);setOrderId('');setNotice('');setBusy(false);setLoading(false);
  }
  function invalidate(){
    const old=sessionRef.current;clear();
    // Finish the old logout response before accepting a new login cookie.
    // Otherwise its delayed Set-Cookie deletion could erase the new session.
    if(old)logoutPending.current=api('/auth/logout','POST',{},old.csrfToken).catch(()=>{});
  }
  function failure(e:unknown){
    const code=e instanceof ClientError?e.code:(e as {code?:number})?.code===4001?'SIGNATURE_CANCELLED':'REQUEST_FAILED';
    if((e instanceof ClientError&&e.status===401)||['WALLET_CHANGED','WRONG_CHAIN'].includes(code))invalidate();
    const messages:Record<string,[string,string]>={
      SIGNATURE_CANCELLED:['已取消登录签名，没有发生交易。','Sign-in signature cancelled. No transaction sent.'],WALLET_REQUIRED:['请安装或解锁钱包。','Install or unlock your wallet.'],WALLET_CHANGED:['钱包或网络已变化，请重新登录。','Wallet or network changed. Sign in again.'],
      PLATFORM_DISABLED:['此环境未启用文件与任务后台；公开 Demo 不包含这些能力。','This environment does not enable the platform. The public demo excludes these capabilities.'],
      NOT_FOUND:['记录不存在或你没有访问权限。','Record not found or access is unavailable.'],FORBIDDEN:['当前角色没有此操作权限。','Your role cannot perform this action.'],
      NEW_FILE_VERSION_REQUIRED:['文件完整性校验失败，不能强制放行。请创建新的受控版本。','Integrity check failed. Create a new controlled version; approval cannot be bypassed.'],
      JOB_VERSION_OR_ACCESS_CHANGED:['任务或权限已变化，请刷新后核对。','Task or access changed. Refresh and review.'],RECOVERY_STATE_CHANGED:['订单状态刚刚发生变化，请重新核验。','Order state just changed. Verify again.'],FILE_ACCESS_NOT_AVAILABLE:['文件暂不可访问。请检查订单、退款状态或保留期限，不要重复付款。','File access is unavailable. Check the order, refund state or retention period. Do not pay again.'],
      FILE_UNAVAILABLE:['文件暂不可用，可刷新或联系工作区管理员。','File is temporarily unavailable. Refresh or contact the workspace owner.'],REQUEST_FAILED:['请求未完成，请刷新核对后重试。','Request did not complete. Refresh and check before retrying.'],
    };
    setError((messages[code]??[code,code])[lang==='zh'?0:1]);
  }
  async function loadSession(){
    const e=epoch.current;
    try{const s=await api<Session>('/session');await checkWallet(s);const ws=await api<Workspace[]>('/workspaces');if(e!==epoch.current)return;sessionRef.current=s;setSession(s);setSpaces(ws);setWid(old=>ws.some(w=>w.id===old)?old:ws[0]?.id??'');}
    catch(err){if(e===epoch.current){if(!(err instanceof ClientError&&err.status===401))failure(err);else clear();}}
    finally{if(e===epoch.current||!sessionRef.current)setLoading(false);}
  }
  useEffect(()=>{document.documentElement.lang=lang;},[lang]);
  useEffect(()=>{
    document.title='ArcBox | Operations';void loadSession();
    const p=provider(),change=()=>{if(sessionRef.current){invalidate();setError('钱包或网络已变化 / Wallet or network changed');}};
    const visible=()=>{if(document.visibilityState==='visible')void loadSession();};
    p?.on?.('accountsChanged',change);p?.on?.('chainChanged',change);document.addEventListener('visibilitychange',visible);
    return()=>{epoch.current++;loads.current++;p?.removeListener?.('accountsChanged',change);p?.removeListener?.('chainChanged',change);document.removeEventListener('visibilitychange',visible);};
  },[]);
  useEffect(()=>{
    if(!session)return;const e=epoch.current,l=++loads.current;setLoading(true);setError('');setFiles(empty());setJobs(empty());setActivity(empty());setOps(null);
    const valid=()=>e===epoch.current&&l===loads.current;
    void (async()=>{try{
      const promises:Promise<unknown>[]=[];
      if(wid)promises.push(api<Operations>(`/workspaces/${wid}/operations`).then(v=>{if(valid())setOps(v);}));
      if(tab==='files'&&wid)promises.push(Promise.all([api<Page<FileItem>>(`/workspaces/${wid}/files`),api<{items:CatalogItem[]}>('/files/catalog')]).then(([f,c])=>{if(valid()){setFiles(f);setCatalog(c.items);}}));
      if(tab==='jobs'&&wid)promises.push(api<Page<JobItem>>(`/workspaces/${wid}/jobs`).then(v=>{if(valid())setJobs(v);}));
      if(tab==='activity'&&wid)promises.push(api<Page<ActivityItem>>(`/workspaces/${wid}/activity`).then(v=>{if(valid())setActivity(v);}));
      if(tab==='notifications')promises.push(api<Page<NotificationItem>>('/me/notifications').then(v=>{if(valid())setNotes(v);}));
      await Promise.all(promises);
    }catch(err){if(valid())failure(err);}finally{if(valid())setLoading(false);}})();
  },[session?.user.id,wid,tab,revision]);
  async function action(fn:(s:Session,check:()=>void)=>Promise<void>,reload=true){
    if(busy||!sessionRef.current)return;const e=epoch.current,s=sessionRef.current;setBusy(true);setError('');setNotice('');
    const check=()=>{if(e!==epoch.current||sessionRef.current?.user.id!==s.user.id)throw new ClientError('WALLET_CHANGED');};
    try{await checkWallet(s);check();await fn(s,check);check();if(reload)setRevision(v=>v+1);}
    catch(err){if(e===epoch.current){if(tab==='recovery')setRecovery(null);failure(err);}}
    finally{if(e===epoch.current)setBusy(false);}
  }
  async function login(){
    if(busy)return;setBusy(true);setError('');const e=epoch.current;
    try{
      await logoutPending.current;if(e!==epoch.current)return;
      const{address,p}=await connectWallet();const s=await signIn(address,p);
      if(e!==epoch.current){logoutPending.current=api('/auth/logout','POST',{},s.csrfToken).catch(()=>{});return;}
      sessionRef.current=s;setSession(s);await loadSession();
    }catch(err){if(e===epoch.current)failure(err);}finally{if(e===epoch.current)setBusy(false);}
  }
  async function put(f:FileItem,s:Session,check:()=>void){
    const c=catalog.find(v=>v.id===f.catalogId);if(!c)throw new ClientError('CONTROLLED_FILE_REQUIRED');check();
    const r=await fetch(`/api/v1/files/${f.id}/content`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'text/plain','X-CSRF-Token':s.csrfToken},body:c.content,signal:AbortSignal.timeout(12000)});
    if(!r.ok){const v=await r.json() as {error?:{code:string}};throw new ClientError(v.error?.code??'REQUEST_FAILED',r.status);}check();
    await api(`/files/${f.id}/complete`,'POST',{},s.csrfToken);check();setNotice(t('文件已接收，等待任务校验。','File received. Verification task is pending.'));
  }
  function importFile(){void action(async(s,check)=>{
    let pending=pendingUpload.current;
    if(!pending||pending.workspaceId!==wid||pending.catalogId!==catalogId||pending.seriesId!==series)pendingUpload.current=pending={key:crypto.randomUUID(),workspaceId:wid,catalogId,seriesId:series};
    const r=await fetch('/api/v1/files/upload-sessions',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrfToken,'Idempotency-Key':pending.key},body:JSON.stringify({workspaceId:wid,catalogId,...(series?{seriesId:series}:{})}),signal:AbortSignal.timeout(12000)});
    const v=await r.json() as {data:FileItem;error?:{code:string}};if(!r.ok)throw new ClientError(v.error?.code??'REQUEST_FAILED',r.status);check();await put(v.data,s,check);pendingUpload.current=null;
  });}
  function continueUpload(f:FileItem){void action((s,check)=>put(f,s,check));}
  function ensureFileTask(f:FileItem){void action(async(s,check)=>{await api(`/files/${f.id}/complete`,'POST',{},s.csrfToken);check();setNotice(t('校验任务已保留，请运行待办任务。','Verification task saved. Run pending tasks.'));});}
  function run(){void action(async(s,check)=>{await api(`/workspaces/${wid}/operations/run`,'POST',{},s.csrfToken);check();setNotice(t('已触发有限批次分发；刷新查看实际执行结果。','Bounded dispatch requested. Refresh to see execution results.'));});}
  function retry(j:JobItem){void action(async(s,check)=>{await api(`/workspaces/${wid}/jobs/${j.id}/retry`,'POST',{},s.csrfToken,j.version);check();await api(`/workspaces/${wid}/operations/run`,'POST',{},s.csrfToken);check();setNotice(t('已重新排队，不会重复付款。','Requeued. This does not repeat a payment.'));});}
  function recover(){void action(async(_s,check)=>{setRecovery(null);if(!/^[a-f0-9-]{36}$/.test(orderId))throw new ClientError('INVALID_ID');const r=await api<Recovery>('/recovery/'+orderId);check();setRecovery(r);},false);}
  function markRead(n:NotificationItem){void action(async(s,check)=>{await api('/me/notifications/read','POST',{id:n.id},s.csrfToken);check();});}
  function saveFile(){void action(async(s,check)=>{
    if(!recovery)return;const id=recovery.order.id,g=await api<DownloadGrant>(`/orders/${id}/downloads`,'POST',{},s.csrfToken);check();
    const r=await fetch(`/api/v1/orders/${id}/download`,{credentials:'same-origin',cache:'no-store',headers:{'X-ArcBox-Download':g.token},signal:AbortSignal.timeout(12000)});
    if(!r.ok){const v=await r.json() as {error?:{code:string}};throw new ClientError(v.error?.code??'REQUEST_FAILED',r.status);}const blob=await r.blob();check();
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=g.file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice(t('文件已交给浏览器保存。','File handed to your browser for saving.'));
  },false);}
  function more(kind:'files'|'jobs'|'notifications'|'activity'){
    const data=kind==='files'?files:kind==='jobs'?jobs:kind==='activity'?activity:notes;if(data.nextCursor===null)return;
    void action(async(_s,check)=>{
      const root=kind==='notifications'?'/me/notifications':`/workspaces/${wid}/${kind}`,result=await api<Page<FileItem|JobItem|NotificationItem|ActivityItem>>(`${root}?cursor=${encodeURIComponent(data.nextCursor!)}`);check();
      if(kind==='files')setFiles(v=>({items:[...v.items,...result.items as FileItem[]],nextCursor:result.nextCursor}));
      if(kind==='jobs')setJobs(v=>({items:[...v.items,...result.items as JobItem[]],nextCursor:result.nextCursor}));
      if(kind==='notifications')setNotes(v=>({items:[...v.items,...result.items as NotificationItem[]],nextCursor:result.nextCursor}));
      if(kind==='activity')setActivity(v=>({items:[...v.items,...result.items as ActivityItem[]],nextCursor:result.nextCursor}));
    },false);
  }
  function changeWorkspace(value:string){if(value===wid)return;loads.current++;setWid(value);setSeries('');setFiles(empty());setJobs(empty());setActivity(empty());setOps(null);setError('');setNotice('');}
  function switchTab(value:Tab){if(value===tab)return;loads.current++;setTab(value);setError('');setNotice('');}
  function changeOrder(value:string){setOrderId(value.trim());setRecovery(null);}
  function openRecovery(id:string){changeOrder(id);switchTab('recovery');}
  function refresh(){if(tab==='recovery'&&recovery)recover();else setRevision(v=>v+1);}
  function logout(){invalidate();setError('');}
  return {lang,setLang,t,date,session,spaces,wid,tab,files,jobs,notes,activity,catalog,catalogId,setCatalogId,series,setSeries,ops,recovery,orderId,error,notice,busy,loading,current,edit,operate,changeWorkspace,switchTab,changeOrder,openRecovery,refresh,logout,login,importFile,continueUpload,ensureFileTask,run,retry,recover,markRead,saveFile,more};
}
