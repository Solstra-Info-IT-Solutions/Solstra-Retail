import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import './LoginPage.css';

export default function RegisterPage() {
  const [name,setName]=useState('');
  const [businessName,setBusinessName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [error,setError]=useState('');
  const [requestId,setRequestId]=useState('');
  const [loading,setLoading]=useState(false);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError('');
    if(password!==confirmPassword){setError('Passwords do not match.');return;}
    setLoading(true);
    try {
      const response=await api.post<{requestId:string;status:string}>('/auth/register',{name,businessName,email,password});
      setRequestId(response.data.requestId);
    } catch(error:any) {
      setError(error?.response?.data?.message||'Registration could not be submitted. Please verify the details and try again.');
    } finally {setLoading(false);}
  }

  return <main className="login-page"><section className="login-card">
    <div className="login-brand"><div className="brand-mark">S</div><span>Solstra Retail</span></div>
    {requestId?<><div className="login-heading"><p className="login-eyebrow">REQUEST SUBMITTED</p><h1>Awaiting Solstra verification</h1><p>Your business registration is pending review. No workspace or login access is created until Solstra approves it.</p></div><div className="login-error" role="status" style={{color:'var(--color-success,#16865d)'}}>Request reference: {requestId}</div><p className="login-footer">Solstra will verify your business details before activating your account.</p><Link to="/login">Return to sign in</Link></>:<>
      <div className="login-heading"><p className="login-eyebrow">NEW BUSINESS</p><h1>Request a workspace</h1><p>Submit your business details for Solstra verification and approval.</p></div>
      <form onSubmit={submit} className="login-form">
        <label htmlFor="owner-name">Owner full name</label><input id="owner-name" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={80} required/>
        <label htmlFor="business-name">Business name</label><input id="business-name" value={businessName} onChange={e=>setBusinessName(e.target.value)} minLength={2} maxLength={100} required/>
        <label htmlFor="register-email">Email address</label><input id="register-email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
        <label htmlFor="register-password">Create password</label><input id="register-password" type="password" autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} required/><small>At least 12 characters, including uppercase, lowercase and a number.</small>
        <label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/>
        {error&&<p className="login-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading}>{loading?'Submitting request…':'Submit for Solstra approval'}</button>
      </form><p className="login-footer">Already approved? <Link to="/login">Sign in</Link></p>
    </>}
  </section></main>;
}
