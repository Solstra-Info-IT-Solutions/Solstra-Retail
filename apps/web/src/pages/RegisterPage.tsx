import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import './LoginPage.css';

const states = [
  ['Andhra Pradesh','37'],['Arunachal Pradesh','12'],['Assam','18'],['Bihar','10'],['Chhattisgarh','22'],['Goa','30'],['Gujarat','24'],['Haryana','06'],['Himachal Pradesh','02'],['Jharkhand','20'],['Karnataka','29'],['Kerala','32'],['Madhya Pradesh','23'],['Maharashtra','27'],['Manipur','14'],['Meghalaya','17'],['Mizoram','15'],['Nagaland','13'],['Odisha','21'],['Punjab','03'],['Rajasthan','08'],['Sikkim','11'],['Tamil Nadu','33'],['Telangana','36'],['Tripura','16'],['Uttar Pradesh','09'],['Uttarakhand','05'],['West Bengal','19'],['Delhi','07'],['Jammu and Kashmir','01'],['Ladakh','38'],['Puducherry','34'],['Chandigarh','04'],['Andaman and Nicobar Islands','35'],['Dadra and Nagar Haveli and Daman and Diu','26'],['Lakshadweep','31']];
const businessTypes = [
  ['GENERAL_RETAIL','General Retail'],['GROCERY','Grocery / Kirana'],['MEDICAL_PHARMACY','Medical / Pharmacy'],['ELECTRONICS','Electronics'],['FASHION_APPAREL','Fashion / Apparel'],['WHOLESALE_DISTRIBUTION','Wholesale / Distribution'],['E_COMMERCE','E-commerce'],['RESTAURANT_FOOD','Restaurant / Food'],['AUTOMOTIVE','Automotive / Spare Parts'],['BEAUTY_COSMETICS','Beauty / Cosmetics'],['HARDWARE_BUILDING','Hardware / Building Materials'],['OTHER','Other'],
];
type RegistrationForm = {name:string;email:string;password:string;businessName:string;storeName:string;ownerPhone:string;alternatePhone:string;businessType:string;businessCategory:string;businessDescription:string;addressLine1:string;addressLine2:string;city:string;district:string;state:string;stateCode:string;pincode:string;country:string;gstRegistered:boolean;gstin:string;gstLegalName:string;gstRegistrationType:string;businessEmail:string;website:string;logoDataUrl:string};
const initial:RegistrationForm={name:'',email:'',password:'',businessName:'',storeName:'',ownerPhone:'',alternatePhone:'',businessType:'GENERAL_RETAIL',businessCategory:'',businessDescription:'',addressLine1:'',addressLine2:'',city:'',district:'',state:'',stateCode:'',pincode:'',country:'India',gstRegistered:false,gstin:'',gstLegalName:'',gstRegistrationType:'',businessEmail:'',website:'',logoDataUrl:''};
export default function RegisterPage() {
  const [form,setForm]=useState<RegistrationForm>(initial);
  const [confirmPassword,setConfirmPassword]=useState('');
  const [error,setError]=useState('');
  const [requestId,setRequestId]=useState('');
  const [loading,setLoading]=useState(false);
  const update=(key:keyof RegistrationForm,value:string|boolean)=>setForm(old=>({...old,[key]:value}));
  async function uploadLogo(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Logo must be PNG, JPG or WebP. SVG files are not accepted.');event.target.value='';return;}
    if(file.size>1024*1024){setError('Logo size must be 1 MB or less.');event.target.value='';return;}
    const reader=new FileReader();reader.onload=()=>{update('logoDataUrl',String(reader.result||''));setError('');};reader.onerror=()=>setError('Logo could not be read. Please choose another image.');reader.readAsDataURL(file);
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError('');
    if(form.password!==confirmPassword){setError('Passwords do not match.');return;}
    if(form.gstRegistered&&(!form.gstin||form.gstin.slice(0,2)!==form.stateCode)){setError('Enter a valid GSTIN that matches the selected business state.');return;}
    const {logoDataUrl,...rest}=form;
    setLoading(true);
    try {
      const response=await api.post<{requestId:string;status:string}>('/auth/register',{...rest,alternatePhone:form.alternatePhone||undefined,businessEmail:form.businessEmail||undefined,website:form.website||undefined,gstin:form.gstRegistered?form.gstin.toUpperCase():undefined,logoDataUrl:logoDataUrl||undefined});
      setRequestId(response.data.requestId);
    } catch(error:any) {
      const message=error?.response?.data?.message;setError(Array.isArray(message)?message.join(', '):message||'Registration could not be submitted. Please verify the details and try again.');
    } finally {setLoading(false);}
  }
  return <main className="login-page"><section className="login-card registration-card">
    <div className="login-brand"><div className="brand-mark">S</div><span>Solstra Retail</span></div>
    {requestId?<><div className="login-heading"><p className="login-eyebrow">REQUEST SUBMITTED</p><h1>Awaiting Solstra verification</h1><p>Your complete business profile has been submitted. No workspace or login access is created until Solstra approves it.</p></div><div className="login-error" role="status" style={{color:'var(--color-success,#16865d)'}}>Request reference: {requestId}</div><p className="login-footer">Solstra will verify your owner, store, address and tax details before activation.</p><Link to="/login">Return to sign in</Link></>:<>
      <div className="login-heading"><p className="login-eyebrow">NEW BUSINESS ONBOARDING</p><h1>Register your store</h1><p>Share your business profile for Solstra verification. Fields marked * are required.</p></div>
      <form onSubmit={submit} className="login-form registration-form">
        <h2>Owner & login details</h2>
        <div className="registration-grid">
          <label>Owner full name *<input autoComplete="name" value={form.name} onChange={e=>update('name',e.target.value)} minLength={2} maxLength={80} required/></label>
          <label>Owner mobile number *<input type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} value={form.ownerPhone} onChange={e=>update('ownerPhone',e.target.value.replace(/\D/g,'').slice(0,10))} required/></label>
          <label>Alternate mobile<input type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} value={form.alternatePhone} onChange={e=>update('alternatePhone',e.target.value.replace(/\D/g,'').slice(0,10))}/></label>
          <label>Login email *</label>
          <input type="email" autoComplete="email" value={form.email} onChange={e=>update('email',e.target.value)} required/>
          <label>Create password *<input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={form.password} onChange={e=>update('password',e.target.value)} required/><small>At least 12 characters, uppercase, lowercase and a number.</small></label>
          <label>Confirm password *<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/></label>
        </div>
        <h2>Business & store details</h2>
        <div className="registration-grid">
          <label>Legal / business name *<input value={form.businessName} onChange={e=>update('businessName',e.target.value)} minLength={2} maxLength={120} required/></label>
          <label>Store / trading name *<input value={form.storeName} onChange={e=>update('storeName',e.target.value)} minLength={2} maxLength={120} required/></label>
          <label>Business industry *<select value={form.businessType} onChange={e=>update('businessType',e.target.value)}>{businessTypes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label>Business sub-category<input placeholder="e.g. surgical supplies, mobile phones" value={form.businessCategory} onChange={e=>update('businessCategory',e.target.value)}/></label>
          <label>Business email<input type="email" value={form.businessEmail} onChange={e=>update('businessEmail',e.target.value)}/></label>
          <label>Website / online store<input type="url" placeholder="https://" value={form.website} onChange={e=>update('website',e.target.value)}/></label>
        </div>
        <label>What does your business do?<textarea rows={3} maxLength={1000} value={form.businessDescription} onChange={e=>update('businessDescription',e.target.value)}/></label>
        <h2>Registered business address</h2>
        <div className="registration-grid">
          <label>Address line 1 *<input value={form.addressLine1} onChange={e=>update('addressLine1',e.target.value)} required/></label>
          <label>Address line 2<input value={form.addressLine2} onChange={e=>update('addressLine2',e.target.value)}/></label>
          <label>City / town *<input value={form.city} onChange={e=>update('city',e.target.value)} required/></label>
          <label>District<input value={form.district} onChange={e=>update('district',e.target.value)}/></label>
          <label>State *<select required value={form.stateCode} onChange={e=>{const selected=states.find(s=>s[1]===e.target.value);setForm(old=>({...old,stateCode:e.target.value,state:selected?.[0]||''}));}}><option value="">Select state / UT</option>{states.map(([name,code])=><option key={code} value={code}>{name}</option>)}</select></label>
          <label>PIN code *<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={form.pincode} onChange={e=>update('pincode',e.target.value.replace(/\D/g,'').slice(0,6))} required/></label>
          <label>Country<input value={form.country} onChange={e=>update('country',e.target.value)} required/></label>
        </div>
        <h2>GST / tax registration</h2>
        <label className="registration-check"><input type="checkbox" checked={form.gstRegistered} onChange={e=>setForm(old=>({...old,gstRegistered:e.target.checked,gstin:e.target.checked?old.gstin:''}))}/> My business is registered under GST</label>
        {form.gstRegistered?<div className="registration-grid">
          <label>GSTIN *<input value={form.gstin} onChange={e=>update('gstin',e.target.value.toUpperCase())} maxLength={15} required/></label>
          <label>GST legal name<input value={form.gstLegalName} onChange={e=>update('gstLegalName',e.target.value)}/></label>
          <label>GST registration type<select value={form.gstRegistrationType} onChange={e=>update('gstRegistrationType',e.target.value)}><option value="">Select type</option><option>Regular</option><option>Composition</option><option>SEZ</option><option>Casual taxable person</option><option>Other</option></select></label>
        </div>:<p className="registration-note">GSTIN is optional for businesses that are not GST registered. You can add it later from your business profile.</p>}
        <h2>Store branding</h2>
        <label>Upload store logo (PNG, JPG or WebP, max 1 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo}/></label>
        {form.logoDataUrl&&<div className="registration-logo"><img src={form.logoDataUrl} alt="Store logo preview"/><button type="button" onClick={()=>update('logoDataUrl','')}>Remove logo</button></div>}
        {error&&<p className="login-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading}>{loading?'Submitting complete profile…':'Submit business for Solstra approval'}</button>
      </form><p className="login-footer">Already approved? <Link to="/login">Sign in</Link></p>
    </>}
  </section></main>;
}