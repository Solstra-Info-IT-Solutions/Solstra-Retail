import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import './AuditPage.css';
type Actor={name?:string;email?:string}|string;
type AuditItem={_id:string;actorId:Actor;actorRole:string;action:string;resource:string;resourceId:string;route:string;ipAddress:string;userAgent:string;occurredAt:string};
type AuditData={items:AuditItem[];pagination:{total:number;page:number;limit:number;totalPages:number}};
const actorName=(v:Actor)=>typeof v==='string'?'User':v?.name||v?.email||'User';
export default function AuditPage(){const [data,setData]=useState<AuditData|null>(null),[page,setPage]=useState(1),[loading,setLoading]=useState(true),[error,setError]=useState('');
const load=useCallback(async()=>{setLoading(true);setError('');try{const r=await api.get<AuditData>('/audit-logs',{params:{page,limit:50}});setData(r.data);}catch{setError('Audit records could not be loaded.');}finally{setLoading(false);}},[page]);
useEffect(()=>{void load();},[load]);
return <div className="audit-page"><header><div><span>SECURITY & ACCOUNTABILITY</span><h1>Audit Trail</h1><p>Append-only activity records for authenticated business mutations.</p></div><button onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
<div className="audit-summary"><ShieldCheck size={20}/><span><small>Recorded activities</small><strong>{data?.pagination.total??'—'}</strong></span><p>Request bodies, passwords, tokens and payment credentials are not stored in this activity log.</p></div>
{error&&<div className="audit-error">{error}</div>}<section className="audit-card"><div className="audit-table-wrap"><table><thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>RESOURCE</th><th>RESOURCE ID</th><th>ROUTE</th><th>IP ADDRESS</th></tr></thead><tbody>{loading?<tr><td colSpan={7}>Loading audit trail...</td></tr>:data?.items.length?data.items.map(item=><tr key={item._id}><td>{new Date(item.occurredAt).toLocaleString('en-IN')}</td><td><strong>{actorName(item.actorId)}</strong><small>{item.actorRole}</small></td><td><span className="audit-method">{item.action}</span></td><td>{item.resource}</td><td>{item.resourceId||'—'}</td><td className="audit-route">{item.route}</td><td>{item.ipAddress||'—'}</td></tr>):<tr><td colSpan={7}>No activity records found.</td></tr>}</tbody></table></div><footer><span>Page {data?.pagination.page??page} of {Math.max(1,data?.pagination.totalPages??1)}</span><div><button disabled={page<=1||loading} onClick={()=>setPage(v=>v-1)}>Previous</button><button disabled={!data||page>=data.pagination.totalPages||loading} onClick={()=>setPage(v=>v+1)}>Next</button></div></footer></section></div>;
}
