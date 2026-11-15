import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Building2, Save, Upload, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import './BusinessProfilePage.css';

const industries=[['GENERAL_RETAIL','General Retail'],['GROCERY','Grocery / Kirana'],['MEDICAL_PHARMACY','Medical / Pharmacy'],['ELECTRONICS','Electronics'],['FASHION_APPAREL','Fashion / Apparel'],['WHOLESALE_DISTRIBUTION','Wholesale / Distribution'],['E_COMMERCE','E-commerce'],['RESTAURANT_FOOD','Restaurant / Food'],['AUTOMOTIVE','Automotive / Spare Parts'],['BEAUTY_COSMETICS','Beauty / Cosmetics'],['HARDWARE_BUILDING','Hardware / Building Materials'],['OTHER','Other']];
type Profile={name:string;storeName:string;businessType:string;businessCategory:string;businessDescription:string;ownerName:string;ownerPhone:string;alternatePhone:string;businessEmail:string;website:string;gstRegistered:boolean;gstin:string;gstLegalName:string;gstRegistrationType:string;state:string;stateCode:string;addressLine1:string;addressLine2:string;city:string;district:string;pincode:string;country:string;logoDataUrl:string|null};
const empty:Profile={name:'',storeName:'',businessType:'GENERAL_RETAIL',businessCategory:'',businessDescription:'',ownerName:'',ownerPhone:'',alternatePhone:'',businessEmail:'',website:'',gstRegistered:false,gstin:'',gstLegalName:'',gstRegistrationType:'',state:'',stateCode:'',addressLine1:'',addressLine2:'',city:'',district:'',pincode:'',country:'India',logoDataUrl:null};
export default function BusinessProfilePage(){
 const [profile,setProfile]=useState<Profile>(empty),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){setLoading(true);setError('');try{const r=await api.get<Profile>('/tenant/profile');setProfile({...empty,...r.data});}catch{setError('Business profile could not be loaded.');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 function set<K extends keyof Profile>(key:K,value:Profile[K]){setProfile(old=>({...old,[key]:value}));}
 async function logo(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>1024*1024){setError('Choose a PNG, JPG or WebP logo up to 1 MB.');event.target.value='';return;}const reader=new FileReader();reader.onload=()=>set('logoDataUrl',String(reader.result));reader.onerror=()=>setError('Logo could not be read.');reader.readAsDataURL(file);}
 async function save(event:FormEvent){event.preventDefault();setSaving(true);setError('');setMessage('');try{const {name,...body}=profile;const r=await api.patch<Profile>('/tenant/profile',{...body,businessName:name,ownerPhone:profile.ownerPhone||undefined,alternatePhone:profile.alternatePhone||undefined,stateCode:profile.stateCode||undefined,pincode:profile.pincode||undefined,gstin:profile.gstRegistered?profile.gstin.toUpperCase():null});setProfile({...empty,...r.data});setMessage('Business profile saved successfully.');}catch(e:any){const m=e?.response?.data?.message;setError(Array.isArray(m)?m.join(', '):m||'Profile could not be saved.');}finally{setSaving(false);}}
 return <div className="business-profile-page"><header><div><span>WORKSPACE SETTINGS</span><h1>Business profile</h1><p>Maintain the legal, tax, contact and branding information used across invoices and business operations.</p></div><button onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
 {error&&<div className="business-profile-alert error">{error}</div>}{message&&<div className="business-profile-alert success">{message}</div>}
 {loading?<p>Loading business profile…</p>:<form onSubmit={save}>
 <section className="business-profile-card"><h2><Building2 size={18}/> Store identity</h2><div className="business-profile-grid">
 <label>Legal / business name<input required minLength={2} maxLength={120} value={profile.name} onChange={e=>set('name',e.target.value)}/></label>
 <label>Store / trading name<input required value={profile.storeName} onChange={e=>set('storeName',e.target.value)}/></label>
 <label>Industry<select value={profile.businessType} onChange={e=>set('businessType',e.target.value)}>{industries.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 <label>Sub-category<input value={profile.businessCategory} onChange={e=>set('businessCategory',e.target.value)}/></label>
 <label>Business email<input type="email" value={profile.businessEmail} onChange={e=>set('businessEmail',e.target.value)}/></label>
 <label>Website<input type="url" value={profile.website} onChange={e=>set('website',e.target.value)}/></label>
 </div><label>Business description<textarea rows={3} value={profile.businessDescription} onChange={e=>set('businessDescription',e.target.value)}/></label>
 <div className="business-profile-logo">{profile.logoDataUrl?<img src={profile.logoDataUrl} alt="Store logo"/>:<div className="business-profile-logo-empty">No logo uploaded</div>}<div><label>Store logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={logo}/></label><small>PNG, JPG or WebP. Maximum 1 MB.</small>{profile.logoDataUrl&&<button type="button" className="business-profile-link" onClick={()=>set('logoDataUrl',null)}>Remove logo</button>}</div></div>
 </section>
 <section className="business-profile-card"><h2>Owner & contact details</h2><div className="business-profile-grid">
 <label>Owner name<input value={profile.ownerName} onChange={e=>set('ownerName',e.target.value)}/></label><label>Primary mobile<input inputMode="numeric" maxLength={10} value={profile.ownerPhone} onChange={e=>set('ownerPhone',e.target.value.replace(/\D/g,'').slice(0,10))}/></label>
 <label>Alternate mobile<input inputMode="numeric" maxLength={10} value={profile.alternatePhone||''} onChange={e=>set('alternatePhone',e.target.value.replace(/\D/g,'').slice(0,10))}/></label>
 </div></section>
 <section className="business-profile-card"><h2>Registered business address</h2><div className="business-profile-grid">
 <label>Address line 1<input value={profile.addressLine1} onChange={e=>set('addressLine1',e.target.value)}/></label><label>Address line 2<input value={profile.addressLine2} onChange={e=>set('addressLine2',e.target.value)}/></label>
 <label>City<input value={profile.city} onChange={e=>set('city',e.target.value)}/></label><label>District<input value={profile.district} onChange={e=>set('district',e.target.value)}/></label>
 <label>State<input value={profile.state} onChange={e=>set('state',e.target.value)}/></label><label>GST state code<input maxLength={2} value={profile.stateCode} onChange={e=>set('stateCode',e.target.value)}/></label>
 <label>PIN code<input maxLength={6} value={profile.pincode} onChange={e=>set('pincode',e.target.value.replace(/\D/g,'').slice(0,6))}/></label><label>Country<input value={profile.country} onChange={e=>set('country',e.target.value)}/></label>
 </div></section>
 <section className="business-profile-card"><h2>GST / tax registration</h2><label className="business-profile-check"><input type="checkbox" checked={profile.gstRegistered} onChange={e=>set('gstRegistered',e.target.checked)}/> This business is GST registered</label>
 {profile.gstRegistered&&<div className="business-profile-grid"><label>GSTIN<input required maxLength={15} value={profile.gstin||''} onChange={e=>set('gstin',e.target.value.toUpperCase())}/></label><label>GST legal name<input value={profile.gstLegalName||''} onChange={e=>set('gstLegalName',e.target.value)}/></label><label>Registration type<input value={profile.gstRegistrationType||''} onChange={e=>set('gstRegistrationType',e.target.value)}/></label></div>}
 </section>
 <footer><button className="business-profile-save" disabled={saving}><Save size={16}/>{saving?'Saving…':'Save business profile'}</button></footer>
 </form>}
 </div>;
}