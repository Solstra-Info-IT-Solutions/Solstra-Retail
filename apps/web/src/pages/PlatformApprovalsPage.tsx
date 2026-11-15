import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, XCircle, Store, Building2, Users, Clock3 } from 'lucide-react';
import { api } from '../api/client';
import './PlatformOperationsPage.css';

type Registration={_id:string;name:string;businessName:string;storeName:string;email:string;ownerPhone:string;alternatePhone?:string;businessType:string;businessCategory?:string;businessDescription?:string;addressLine1:string;addressLine2?:string;city:string;district?:string;state:string;stateCode:string;pincode:string;country:string;gstRegistered:boolean;gstin?:string;gstLegalName?:string;gstRegistrationType?:string;businessEmail?:string;website?:string;logoDataUrl?:string;createdAt:string};
type PasswordRequest={_id:string;email:string;createdAt:string;userId?:{name?:string;email?:string};tenantId?:{name?:string}};
type StoreRecord=Registration & {_id:string;slug:string;status:string;subscriptionStatus:string;subscriptionPlan:string;trialEndsAt?:string;owner?:{name:string;email:string;isActive:boolean}|null};
type Summary={registrations:{pending:number;approved:number;rejected:number;expired:number};stores:{total:number;active:number;suspended:number}};
const industryLabel=(value:string)=>({GENERAL_RETAIL:'General Retail',GROCERY:'Grocery / Kirana',MEDICAL_PHARMACY:'Medical / Pharmacy',ELECTRONICS:'Electronics',FASHION_APPAREL:'Fashion / Apparel',WHOLESALE_DISTRIBUTION:'Wholesale / Distribution',E_COMMERCE:'E-commerce',RESTAURANT_FOOD:'Restaurant / Food',AUTOMOTIVE:'Automotive',BEAUTY_COSMETICS:'Beauty / Cosmetics',HARDWARE_BUILDING:'Hardware / Building Materials',OTHER:'Other'} as Record<string,string>)[value]||value;
export default function PlatformApprovalsPage(){
  const [registrations,setRegistrations]=useState<Registration[]>([]),[passwords,setPasswords]=useState<PasswordRequest[]>([]),[stores,setStores]=useState<StoreRecord[]>([]);
  const [summary,setSummary]=useState<Summary|null>(null),[search,setSearch]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');try{const [r,p,s,d]=await Promise.all([api.get<Registration[]>('/auth/platform/registration-requests'),api.get<PasswordRequest[]>('/auth/platform/password-change-requests'),api.get<Summary>('/auth/platform/registration-summary'),api.get<StoreRecord[]>('/auth/platform/store-directory')]);setRegistrations(r.data||[]);setPasswords(p.data||[]);setSummary(s.data);setStores(d.data||[]);}catch{setError('Solstra platform data is unavailable. Confirm this account is listed in PLATFORM_ADMIN_USER_IDS on Render.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function review(kind:'registration'|'password',id:string,decision:'APPROVE'|'REJECT'){
    const reason=window.prompt('Enter the verification/review reason (minimum 8 characters):');if(!reason||reason.trim().length<8)return;
    setBusy(true);setError('');setMessage('');
    try{await api.post('/auth/platform/'+(kind==='registration'?'registration-requests':'password-change-requests')+'/'+id+'/review',{decision,reason:reason.trim()});setMessage(kind==='registration'?(decision==='APPROVE'?'Store approved. Owner can now sign in.':'Store registration rejected.'):(decision==='APPROVE'?'Password changed and previous sessions revoked.':'Password change rejected; current password remains active.'));await load();}
    catch(e:any){setError(e?.response?.data?.message||'Approval action failed. Refresh and retry.');}
    finally{setBusy(false);}
  }
  const filtered=stores.filter(s=>[s.name,s.storeName,s.owner?.name,s.owner?.email,s.ownerPhone,s.city,s.state,s.gstin,s.slug].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())));
  return <div className="platform-page"><header><div><span>SOLSTRA PLATFORM GOVERNANCE</span><h1>Store Registry & Approvals</h1><p>Central oversight of every registered business, its owner, industry, tax profile and workspace status.</p></div><button onClick={()=>void load()} disabled={loading||busy}><RefreshCw size={15}/> Refresh</button></header>
    {error&&<div className="platform-alert error">{error}</div>}{message&&<div className="platform-alert success">{message}</div>}
    <section className="platform-card"><h2><Building2 size={18}/> Platform overview</h2><div className="platform-registry-stats">
      <article><Store/><strong>{summary?.stores.total??'—'}</strong><span>Total stores</span></article>
      <article><CheckCircle2/><strong>{summary?.stores.active??'—'}</strong><span>Active stores</span></article>
      <article><Clock3/><strong>{summary?.registrations.pending??registrations.length}</strong><span>Pending registrations</span></article>
      <article><Users/><strong>{summary?.registrations.approved??'—'}</strong><span>Approved registrations</span></article>
      <article><XCircle/><strong>{summary?.registrations.rejected??'—'}</strong><span>Rejected requests</span></article>
    </div><p className="platform-muted">Suspended stores: {summary?.stores.suspended??'—'} · Expired registration requests: {summary?.registrations.expired??'—'}</p></section>
    <section className="platform-card"><h2><ShieldCheck size={18}/> New business registrations · {registrations.length} pending</h2><p className="platform-muted">Review the complete submitted business profile before activation. Approval creates the workspace and owner account and starts the 7-day trial.</p>
      {registrations.length?registrations.map(r=><article className="platform-discrepancy platform-registration" key={r._id}>
        <div className="platform-registration-heading">{r.logoDataUrl?<img src={r.logoDataUrl} alt="Store logo"/>:<div className="platform-registration-logo">S</div>}<div><b>{r.storeName||r.businessName}</b><small>{r.businessName} · {industryLabel(r.businessType)}</small><small>Owner: {r.name} · {r.email} · +91 {r.ownerPhone}</small></div></div>
        <div className="platform-registration-details"><span><b>Address</b>{[r.addressLine1,r.addressLine2,r.city,r.district,r.state,r.pincode,r.country].filter(Boolean).join(', ')}</span><span><b>GST status</b>{r.gstRegistered?'Registered · '+(r.gstin||'GSTIN missing'):'Not GST registered'}</span>{r.gstRegistered&&<span><b>GST legal profile</b>{[r.gstLegalName,r.gstRegistrationType].filter(Boolean).join(' · ')||'Not provided'}</span>}<span><b>Contact</b>{[r.alternatePhone,r.businessEmail,r.website].filter(Boolean).join(' · ')||'No additional contact'}</span>{r.businessDescription&&<span><b>Business description</b>{r.businessDescription}</span>}</div>
        <small>Submitted: {new Date(r.createdAt).toLocaleString('en-IN')}</small>
        <div className="platform-trigger"><button disabled={busy} onClick={()=>void review('registration',r._id,'APPROVE')}><CheckCircle2 size={15}/> Approve & activate</button><button disabled={busy} onClick={()=>void review('registration',r._id,'REJECT')}><XCircle size={15}/> Reject</button></div>
      </article>):<p className="platform-muted">No registration requests awaiting review.</p>}
    </section>
    <section className="platform-card"><h2><Store size={18}/> Registered store directory · {stores.length} stores</h2><p className="platform-muted">Search and inspect the business profile, owner contact, GST status and subscription state of every onboarded store.</p><input className="platform-store-search" placeholder="Search store, owner, email, city, GSTIN…" value={search} onChange={e=>setSearch(e.target.value)}/>
      {filtered.map(s=><article className="platform-discrepancy platform-store-row" key={s._id}><div className="platform-registration-heading">{s.logoDataUrl?<img src={s.logoDataUrl} alt="Store logo"/>:<div className="platform-registration-logo">S</div>}<div><b>{s.storeName||s.name}</b><small>{s.name} · {industryLabel(s.businessType)} · {s.slug}</small><small>Owner: {s.owner?.name||s.ownerName||'—'} · {s.owner?.email||'—'} · {s.ownerPhone||'—'}</small></div><span className="platform-store-status">{s.status} · {s.subscriptionStatus}</span></div>
        <div className="platform-registration-details"><span><b>Location</b>{[s.city,s.state,s.pincode,s.country].filter(Boolean).join(', ')}</span><span><b>GST</b>{s.gstRegistered?'Registered · '+(s.gstin||'GSTIN not supplied'):'Not registered'}</span><span><b>Plan</b>{s.subscriptionPlan||'starter'}{s.trialEndsAt?' · Trial ends '+new Date(s.trialEndsAt).toLocaleDateString('en-IN'):''}</span></div>
      </article>)}
      {!filtered.length&&<p className="platform-muted">No stores match this search.</p>}
    </section>
    <section className="platform-card"><h2><ShieldCheck size={18}/> Password changes · {passwords.length} pending</h2><p className="platform-muted">The requested new password is stored only as a one-way hash. Solstra reviewers cannot view it. Approval revokes all existing sessions.</p>
      {passwords.length?passwords.map(r=><article className="platform-discrepancy" key={r._id}><b>{r.tenantId?.name||'Business workspace'}</b><small>Account: {r.userId?.name||'User'} · {r.email}</small><small>Submitted: {new Date(r.createdAt).toLocaleString('en-IN')}</small><div className="platform-trigger"><button disabled={busy} onClick={()=>void review('password',r._id,'APPROVE')}><CheckCircle2 size={15}/> Approve password change</button><button disabled={busy} onClick={()=>void review('password',r._id,'REJECT')}><XCircle size={15}/> Reject</button></div></article>):<p className="platform-muted">No password changes awaiting review.</p>}
    </section>
    {loading&&<p className="platform-muted">Loading platform registry…</p>}
  </div>;
}