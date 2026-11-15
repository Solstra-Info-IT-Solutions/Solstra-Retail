import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';

type RequestStatus={_id?:string;status:string;reviewReason?:string;createdAt?:string;reviewedAt?:string};
export default function AccountSecurityPage(){
  const [currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
  const [request,setRequest]=useState<RequestStatus>({status:'NONE'}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function load(){try{const r=await api.get<RequestStatus>('/auth/password-change-requests/me');setRequest(r.data);}catch{setError('Password request status could not be loaded.');}}
  useEffect(()=>{void load();},[]);
  async function submit(e:FormEvent){e.preventDefault();setError('');setMessage('');if(newPassword!==confirmPassword){setError('New passwords do not match.');return;}setBusy(true);try{const r=await api.post('/auth/password-change-requests',{currentPassword,newPassword});setMessage(r.data.message);setCurrentPassword('');setNewPassword('');setConfirmPassword('');await load();}catch(error:any){setError(error?.response?.data?.message||'Password change request could not be submitted.');}finally{setBusy(false);}}
  return <div className="platform-page"><header><div><span>ACCOUNT PROTECTION</span><h1>Account Security</h1><p>Request a password change. Your existing password stays active until Solstra approves the request.</p></div></header>
    {error&&<div className="platform-alert error">{error}</div>}{message&&<div className="platform-alert success">{message}</div>}
    <section className="platform-card" style={{maxWidth:620}}><h2>Change password · Solstra approval required</h2><form className="platform-form" onSubmit={submit}>
      <label>Current password<input type="password" autoComplete="current-password" minLength={12} value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required/></label>
      <label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/></label>
      <small>Use at least 12 characters, with uppercase, lowercase and a number. Solstra reviewers never see your password.</small>
      <button disabled={busy||request.status==='PENDING_APPROVAL'}>{busy?'Submitting…':request.status==='PENDING_APPROVAL'?'Approval pending':'Submit password change request'}</button>
    </form></section>
    <section className="platform-card" style={{maxWidth:620}}><h2>Latest request</h2><p><b>Status:</b> {request.status.replace(/_/g,' ')}</p>{request.createdAt&&<p>Submitted: {new Date(request.createdAt).toLocaleString('en-IN')}</p>}{request.reviewedAt&&<p>Reviewed: {new Date(request.reviewedAt).toLocaleString('en-IN')}</p>}{request.reviewReason&&<p>Solstra note: {request.reviewReason}</p>}</section>
  </div>;
}
