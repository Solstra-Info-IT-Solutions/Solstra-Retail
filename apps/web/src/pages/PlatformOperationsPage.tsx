import { useCallback, useEffect, useState } from 'react';
import { Activity, Bell, Bot, CloudDownload, PlugZap, RefreshCw, ShieldCheck, Wifi, Workflow } from 'lucide-react';
import { api } from '../api/client';
import { listQueuedOfflineSales } from '../api/offlineSales';
import './PlatformOperationsPage.css';

type Rule = { _id: string; name: string; eventType: string; actionType: string; enabled: boolean; triggerCount: number };
type Notice = { _id: string; title: string; body: string; severity: string; category: string; readAt?: string | null; createdAt: string };
type Hook = { _id: string; name: string; endpointUrl: string; events: string[]; enabled: boolean; lastDeliveredAt?: string };
type Policy = { enabled: boolean; frequency: string; retentionDays: number; nextRunAt?: string | null; lastRunAt?: string | null; lastStatus?: string };
type Backup = { _id:string; fileName:string; checksumSha256:string; documentCount:number; compressedBytes:number; expiresAt:string; createdAt:string };
type SaaSTenant = { _id:string; name:string; slug:string; status:string; subscriptionStatus:string; subscriptionPlan:string; maxUsers:number; maxProducts:number; maxBranches:number };
type Valuation = { summary: { products: number; valuationPending: number; overAllocated: number; withinAggregateTotals: number }; pending: Array<{productId:string;name:string;stockQty:number}>; discrepancies: Array<{productId:string;name:string;quantityDelta:number;valueDelta:number}> };
const events = ['MANUAL','SALE_CREATED','LOW_STOCK','EXPENSE_PENDING_APPROVAL'];
const eventLabel = (value:string) => value.replace(/_/g,' ').toLowerCase().replace(/^./,v=>v.toUpperCase());
const makeEventKey = () => { const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''); };
export default function PlatformOperationsPage() {
  const [rules,setRules]=useState<Rule[]>([]),[notices,setNotices]=useState<Notice[]>([]),[hooks,setHooks]=useState<Hook[]>([]);
  const [policy,setPolicy]=useState<Policy>({enabled:false,frequency:'DAILY',retentionDays:30});
  const [valuation,setValuation]=useState<Valuation|null>(null),[pendingOffline,setPendingOffline]=useState(0),[backups,setBackups]=useState<Backup[]>([]),[saasTenants,setSaasTenants]=useState<SaaSTenant[]>([]),[saasAudit,setSaasAudit]=useState<any[]>([]),[saasUsage,setSaasUsage]=useState<any|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [ruleForm,setRuleForm]=useState({name:'',eventType:'SALE_CREATED',actionType:'NOTIFY',integrationId:'',title:'New sale recorded',body:'A sale was successfully created.'});
  const [hookForm,setHookForm]=useState({name:'',endpointUrl:'',events:['SALE_CREATED']});
  const [secret,setSecret]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try {
      const [r,n,h,p,v,q,bk]=await Promise.all([
        api.get<Rule[]>('/platform/automation/rules'),
        api.get<{items:Notice[]}>('/platform/notifications',{params:{page:1}}),
        api.get<Hook[]>('/platform/integrations/webhooks'),
        api.get<Policy>('/platform/backups/policy'),
        api.get<Valuation>('/platform/inventory/valuation-reconciliation'),
        listQueuedOfflineSales(),
        api.get<Backup[]>('/platform/backups'),
      ]);
      setRules(r.data);setNotices(n.data.items||[]);setHooks(h.data);setPolicy(p.data);setValuation(v.data);setPendingOffline(q.length);setBackups(bk.data||[]);
    } catch {setError('Some platform operations could not be loaded. Verify your permissions and refresh.');}
    finally {setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{let active=true;Promise.all([api.get<SaaSTenant[]>('/platform/saas/tenants'),api.get('/platform/saas/audit'),api.get('/platform/saas/usage')]).then(([t,a,u])=>{if(active){setSaasTenants(t.data);setSaasAudit(a.data);setSaasUsage(u.data);}}).catch(()=>undefined);return()=>{active=false};},[]);
  async function createRule(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');try{
    await api.post('/platform/automation/rules',{name:ruleForm.name,eventType:ruleForm.eventType,actionType:ruleForm.actionType,config:ruleForm.actionType==='WEBHOOK'?{integrationId:ruleForm.integrationId}:{title:ruleForm.title,body:ruleForm.body,severity:'INFO'}});
    setRuleForm(v=>({...v,name:''}));setMessage('Automation rule created.');await load();
  }catch{setError('Automation rule could not be created.')}finally{setBusy(false)}}
  async function trigger(eventType:string){setBusy(true);setError('');setMessage('');try{
    await api.post('/platform/automation/trigger',{eventType,eventKey:'manual-'+makeEventKey(),payload:{source:'platform-workspace'}});
    setMessage('Automation event processed.');await load();
  }catch{setError('Automation event could not be processed.')}finally{setBusy(false)}}
  async function toggleRule(rule:Rule){setBusy(true);try{await api.patch('/platform/automation/rules/'+rule._id,{enabled:!rule.enabled});await load()}catch{setError('Rule status could not be changed.')}finally{setBusy(false)}}
  async function createHook(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setSecret('');try{
    const response=await api.post<{secret:string}>('/platform/integrations/webhooks',hookForm);setSecret(response.data.secret);setHookForm({name:'',endpointUrl:'',events:['SALE_CREATED']});setMessage('Webhook created. Copy the signing secret now; it is shown only once.');await load();
  }catch{setError('Webhook could not be created. Confirm HTTPS endpoint and server-side encryption configuration.')}finally{setBusy(false)}}
  async function toggleHook(hook:Hook){setBusy(true);try{await api.patch('/platform/integrations/webhooks/'+hook._id,{enabled:!hook.enabled});await load()}catch{setError('Webhook status could not be changed.')}finally{setBusy(false)}}
  async function deliverHooks(){setBusy(true);try{const r=await api.post<{processed:number}>('/platform/integrations/webhooks/deliver-due');setMessage('Webhook deliveries processed: '+r.data.processed);await load()}catch{setError('Webhook delivery worker failed.')}finally{setBusy(false)}}
  async function savePolicy(){setBusy(true);try{const r=await api.patch<Policy>('/platform/backups/policy',policy);setPolicy(r.data);setMessage('Backup schedule saved. The application worker runs due backups automatically; copy stored archives to a separate cloud account for disaster recovery.')}catch{setError('Backup policy could not be saved.')}finally{setBusy(false)}}
  async function exportBackup(){setBusy(true);setError('');try{
    const r=await api.post<{archiveBase64:string;fileName:string;checksumSha256:string}>('/platform/backups/export');
    const bytes=Uint8Array.from(atob(r.data.archiveBase64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/gzip'}));const a=document.createElement('a');a.href=url;a.download=r.data.fileName;a.click();URL.revokeObjectURL(url);setMessage('Backup exported. SHA-256: '+r.data.checksumSha256);
  }catch{setError('Backup export failed.')}finally{setBusy(false)}}

  async function downloadStoredBackup(id:string){setBusy(true);try{const r=await api.get<{archiveBase64:string;fileName:string}>('/platform/backups/'+id+'/download');const bytes=Uint8Array.from(atob(r.data.archiveBase64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/gzip'}));const a=document.createElement('a');a.href=url;a.download=r.data.fileName;a.click();URL.revokeObjectURL(url);}catch{setError('Stored backup could not be downloaded or its checksum failed.')}finally{setBusy(false)}}
  async function verifyBackupFile(file:File){setBusy(true);try{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const r=await api.post('/platform/backups/verify',{archiveBase64:btoa(binary)});setMessage(r.data.note||'Backup archive verified.');}catch{setError('Backup archive verification failed.')}finally{setBusy(false)}}
  async function updateSaasTenant(tenant:SaaSTenant){const reason=window.prompt('Mandatory reason for changing subscription or workspace controls:');if(!reason?.trim())return;setBusy(true);try{await api.patch('/platform/saas/tenants/'+tenant._id,{subscriptionPlan:'business',reason});const r=await api.get<SaaSTenant[]>('/platform/saas/tenants');setSaasTenants(r.data);const a=await api.get('/platform/saas/audit');setSaasAudit(a.data);setMessage('Subscription updated and audit event recorded.')}catch{setError('SaaS tenant update failed.')}finally{setBusy(false)}}
  async function markRead(id:string){try{await api.patch('/platform/notifications/'+id+'/read',{});await load()}catch{setError('Notification could not be marked as read.')}}
  return <div className="platform-page">
    <header><div><span>OPERATIONS, AUTOMATION & PLATFORM CONTROL</span><h1>Platform Operations</h1><p>Manage business rules, notifications, integrations, offline billing and recovery controls.</p></div><button onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
    {error&&<div className="platform-alert error">{error}</div>}{message&&<div className="platform-alert success">{message}</div>}
    {secret&&<div className="platform-secret"><b>Webhook signing secret — copy now</b><code>{secret}</code><button onClick={()=>void navigator.clipboard.writeText(secret)}>Copy secret</button><small>The server stores this secret encrypted. It cannot be viewed again.</small></div>}
    <div className="platform-stats"><article><Workflow/><small>Automation rules</small><strong>{rules.length}</strong></article><article><Bell/><small>Unread notifications</small><strong>{notices.filter(n=>!n.readAt).length}</strong></article><article><PlugZap/><small>Webhook endpoints</small><strong>{hooks.length}</strong></article><article><Wifi/><small>Offline invoices queued here</small><strong>{pendingOffline}</strong></article></div>
    <div className="platform-grid">
      <section className="platform-card"><h2><Workflow size={18}/> Workflow automation</h2><form onSubmit={createRule} className="platform-form">
        <label>Rule name<input required minLength={3} value={ruleForm.name} onChange={e=>setRuleForm(v=>({...v,name:e.target.value}))} placeholder="Notify on new sale"/></label>
        <label>Trigger<select value={ruleForm.eventType} onChange={e=>setRuleForm(v=>({...v,eventType:e.target.value}))}>{events.map(e=><option key={e} value={e}>{eventLabel(e)}</option>)}</select></label>
        <label>Action<select value={ruleForm.actionType} onChange={e=>setRuleForm(v=>({...v,actionType:e.target.value}))}><option value="NOTIFY">In-app notification</option><option value="WEBHOOK">Webhook delivery</option></select></label>
        {ruleForm.actionType==='WEBHOOK'?<label>Webhook integration<select required value={ruleForm.integrationId} onChange={e=>setRuleForm(v=>({...v,integrationId:e.target.value}))}><option value="">Select an integration</option>{hooks.filter(h=>h.enabled&&h.events.includes(ruleForm.eventType)).map(h=><option key={h._id} value={h._id}>{h.name}</option>)}</select></label>:<>
          <label>Notification title<input required value={ruleForm.title} onChange={e=>setRuleForm(v=>({...v,title:e.target.value}))}/></label>
          <label>Message<textarea value={ruleForm.body} onChange={e=>setRuleForm(v=>({...v,body:e.target.value}))}/></label>
        </>}
        <button disabled={busy|| (ruleForm.actionType==='WEBHOOK'&&!ruleForm.integrationId)}>Create automation rule</button>
      </form>
      <div className="platform-list">{rules.map(rule=><article key={rule._id}><div><b>{rule.name}</b><small>{eventLabel(rule.eventType)} · {rule.triggerCount} runs</small></div><button onClick={()=>void toggleRule(rule)} disabled={busy}>{rule.enabled?'Pause':'Enable'}</button></article>)}</div>
      <div className="platform-trigger"><small>Manual test trigger</small>{events.map(event=><button key={event} onClick={()=>void trigger(event)} disabled={busy}>{eventLabel(event)}</button>)}</div></section>
      <section className="platform-card"><h2><Bell size={18}/> Notification centre</h2><div className="platform-list">{notices.length?notices.slice(0,12).map(n=><article key={n._id} className={n.readAt?'read':''}><div><b>{n.title}</b><small>{n.body}</small><small>{new Date(n.createdAt).toLocaleString('en-IN')} · {n.severity}</small></div>{!n.readAt&&<button onClick={()=>void markRead(n._id)}>Mark read</button>}</article>):<p className="platform-muted">No notifications yet.</p>}</div></section>
      <section className="platform-card"><h2><PlugZap size={18}/> Secure webhook integrations</h2><form onSubmit={createHook} className="platform-form">
        <label>Integration name<input required value={hookForm.name} onChange={e=>setHookForm(v=>({...v,name:e.target.value}))}/></label>
        <label>HTTPS endpoint<input type="url" required value={hookForm.endpointUrl} onChange={e=>setHookForm(v=>({...v,endpointUrl:e.target.value}))} placeholder="https://your-service.example/webhook"/></label>
        <label>Events<select multiple value={hookForm.events} onChange={e=>setHookForm(v=>({...v,events:Array.from(e.target.selectedOptions,o=>o.value)}))}>{events.filter(e=>e!=='MANUAL').map(e=><option key={e} value={e}>{eventLabel(e)}</option>)}</select></label>
        <button disabled={busy}>Add webhook</button>
      </form>
      <div className="platform-list">{hooks.map(h=><article key={h._id}><div><b>{h.name}</b><small>{h.endpointUrl}</small><small>{h.events.join(', ')}</small></div><button onClick={()=>void toggleHook(h)}>{h.enabled?'Disable':'Enable'}</button></article>)}</div>
      <button className="platform-secondary" onClick={()=>void deliverHooks()} disabled={busy}>Process due webhook deliveries</button></section>
      <section className="platform-card"><h2><CloudDownload size={18}/> Backup & recovery</h2><div className="platform-form">
        <label className="platform-check"><input type="checkbox" checked={policy.enabled} onChange={e=>setPolicy(v=>({...v,enabled:e.target.checked}))}/> Enable backup schedule metadata</label>
        <label>Frequency<select value={policy.frequency} onChange={e=>setPolicy(v=>({...v,frequency:e.target.value}))}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option></select></label>
        <label>Retention policy (days)<input type="number" min="1" max="90" value={policy.retentionDays} onChange={e=>setPolicy(v=>({...v,retentionDays:Number(e.target.value)}))}/></label>
        <button onClick={()=>void savePolicy()} disabled={busy}>Save schedule</button><button className="platform-secondary" onClick={()=>void exportBackup()} disabled={busy}>Export tenant backup (.json.gz)</button>
        <small>Scheduled exports run every minute when due and are stored in GridFS on this MongoDB cluster. Password hashes are excluded. For disaster recovery, replicate/download these archives to a separate cloud account or offline vault.</small><label>Verify an exported archive<input type="file" accept=".gz,.json.gz,application/gzip" onChange={e=>{const file=e.target.files?.[0];if(file)void verifyBackupFile(file);e.currentTarget.value='';}}/></label><div className="platform-list">{backups.map(b=><article key={b._id}><div><b>{b.fileName}</b><small>{b.documentCount} documents · {(b.compressedBytes/1024/1024).toFixed(2)} MB · expires {new Date(b.expiresAt).toLocaleDateString('en-IN')}</small></div><button onClick={()=>void downloadStoredBackup(b._id)} disabled={busy}>Download</button></article>)}</div>
      </div></section>
      <section className="platform-card"><h2><ShieldCheck size={18}/> Inventory valuation reconciliation</h2>{valuation?<><div className="platform-recon-stats"><span>Tracked products <b>{valuation.summary.products}</b></span><span>Valuation pending <b>{valuation.summary.valuationPending}</b></span><span>Over-allocated <b>{valuation.summary.overAllocated}</b></span></div><p className="platform-muted">Unallocated stock is allowed. This read-only check flags warehouse allocations exceeding aggregate stock or value.</p>{valuation.discrepancies.slice(0,8).map(row=><article className="platform-discrepancy" key={row.productId}><b>{row.name}</b><small>Qty variance {row.quantityDelta} · Value variance ₹{row.valueDelta.toFixed(2)}</small></article>)}</>:<p className="platform-muted">Loading reconciliation…</p>}</section>
      <section className="platform-card"><h2><Activity size={18}/> Offline POS sync</h2><p>Invoices saved in this browser are stored in IndexedDB and automatically submitted when connectivity returns. The server applies the normal sales validation, stock checks, accounting transaction and idempotency rules.</p><p><b>{pendingOffline}</b> pending invoice(s) in this browser's queue.</p><p className="platform-muted">Do not clear browser site data until the queue has synchronized. A separate device has its own queue.</p></section>
      <section className="platform-card"><h2><Bot size={18}/> SaaS operator controls</h2>{saasUsage?<p>{saasUsage.totalUsers} users · {saasUsage.totalProducts} products across {saasTenants.length} workspaces</p>:<p>Tenant plan, suspension and capacity administration is restricted to user IDs listed in server-side <code>PLATFORM_ADMIN_USER_IDS</code>.</p>}{saasTenants.map(t=><article className="platform-discrepancy" key={t._id}><b>{t.name} · {t.subscriptionPlan||'starter'}</b><small>{t.status} / {t.subscriptionStatus} · users {t.maxUsers} · products {t.maxProducts} · branches {t.maxBranches}</small><button onClick={()=>void updateSaasTenant(t)} disabled={busy}>Upgrade to Business</button></article>)}{saasAudit.slice(0,5).map((a:any)=><p className="platform-muted" key={a._id}>{a.tenantId?.name||'Workspace'} · {a.reason} · {new Date(a.createdAt).toLocaleString('en-IN')}</p>)}</section>
    </div>
    {loading&&<p className="platform-muted">Refreshing platform operations…</p>}
  </div>;
}
