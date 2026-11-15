import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../api/client';

type Registration={_id:string;name:string;businessName:string;email:string;createdAt:string};
type PasswordRequest={_id:string;email:string;createdAt:string;userId?:{name?:string;email?:string};tenantId?:{name?:string}};
export default function PlatformApprovalsPage(){
  const [registrations,setRegistrations]=useState<Registration[]>([]),[passwords,setPasswords]=useState<PasswordRequest[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');try{const [r,p]=await Promise.all([api.get<Registration[]>('/auth/platform/registration-requests'),api.get<PasswordRequest[]>('/auth/platform/password-change-requests')]);setRegistrations(r.data||[]);setPasswords(p.data||[]);}catch{setError('Approval queues are unavailable. Confirm this account is listed in PLATFORM_ADMIN_USER_IDS on Render.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function review(kind:'registration'|'password',id:string,decision:'APPROVE'|'REJECT'){
    const reason=window.prompt('Enter the verification/review reason (minimum 8 characters):');if(!reason||reason.trim().length<8)return;
    setBusy(true);setError('');setMessage('');
    try{await api.post('/auth/platform/'+(kind==='registration'?'registration-requests':'password-change-requests')+'/'+id+'/review',{decision,reason:reason.trim()});setMessage(kind==='registration'?(decision==='APPROVE'?'Business registration approved. Client can now sign in.':'Business registration rejected.'):(decision==='APPROVE'?'Password changed and previous sessions revoked.':'Password change rejected; current password remains active.'));await load();}
    catch(e:any){setError(e?.response?.data?.message||'Approval action failed. Refresh and retry.');}
    finally{setBusy(false);}
  }
  return <div className="platform-page"><header><div><span>SOLSTRA PLATFORM GOVERNANCE</span><h1>Security Approvals</h1><p>Verify new businesses and review sensitive account password changes.</p></div><button onClick={()=>void load()} disabled={loading||busy}><RefreshCw size={15}/> Refresh</button></header>
    {error&&<div className="platform-alert error">{error}</div>}{message&&<div className="platform-alert success">{message}</div>}
    <section className="platform-card"><h2><ShieldCheck size={18}/> New business registrations · {registrations.length} pending</h2><p className="platform-muted">Review business ownership and contact details before approving. Approval creates the tenant and owner account and starts the 7-day trial. Rejected requests never receive login access.</p>
      {registrations.length?registrations.map(r=><article className="platform-discrepancy" key={r._id}><b>{r.businessName}</b><small>Owner: {r.name} · {r.email}</small><small>Submitted: {new Date(r.createdAt).toLocaleString('en-IN')}</small><div className="platform-trigger"><button disabled={busy} onClick={()=>void review('registration',r._id,'APPROVE')}><CheckCircle2 size={15}/> Approve & activate</button><button disabled={busy} onClick={()=>void review('registration',r._id,'REJECT')}><XCircle size={15}/> Reject</button></div></article>):<p className="platform-muted">No registration requests awaiting review.</p>}
    </section>
    <section className="platform-card"><h2><ShieldCheck size={18}/> Password changes · {passwords.length} pending</h2><p className="platform-muted">The requested new password is stored only as a one-way hash. Solstra reviewers cannot view it. Approval changes the hash and revokes all existing sessions.</p>
      {passwords.length?passwords.map(r=><article className="platform-discrepancy" key={r._id}><b>{r.tenantId?.name||'Business workspace'}</b><small>Account: {r.userId?.name||'User'} · {r.email}</small><small>Submitted: {new Date(r.createdAt).toLocaleString('en-IN')}</small><div className="platform-trigger"><button disabled={busy} onClick={()=>void review('password',r._id,'APPROVE')}><CheckCircle2 size={15}/> Approve password change</button><button disabled={busy} onClick={()=>void review('password',r._id,'REJECT')}><XCircle size={15}/> Reject</button></div></article>):<p className="platform-muted">No password changes awaiting review.</p>}
    </section>
    {loading&&<p className="platform-muted">Loading approval queues…</p>}
  </div>;
}
