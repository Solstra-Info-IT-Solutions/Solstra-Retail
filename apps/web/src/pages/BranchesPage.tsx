import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Building2, Warehouse, Plus, RefreshCw, ArrowLeftRight, Archive } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import './BranchesPage.css';

type WarehouseRecord = { _id: string; name: string; code: string; isActive: boolean; isDefault: boolean };
type Branch = { _id: string; name: string; code: string; city?: string; state?: string; isPrimary: boolean; isActive: boolean; warehouses?: WarehouseRecord[] };
type Transfer = { _id: string; productId: { name?: string } | string; quantity: number; sourceWarehouseId: { name?: string } | string; destinationWarehouseId: { name?: string } | string; reason: string; createdAt: string };
type Product = { _id: string; name: string; sku?: string };
const label = (v: { name?: string } | string) => typeof v === 'string' ? '—' : v?.name || '—';

export default function BranchesPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const [branches, setBranches] = useState<Branch[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branchOpen, setBranchOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [branchForm, setBranchForm] = useState({ name: '', code: '', city: '', state: '', isPrimary: false });
  const [warehouseForm, setWarehouseForm] = useState({ name: '', code: '', isDefault: false });
  const [transferForm, setTransferForm] = useState({ productId: '', sourceWarehouseId: '', destinationWarehouseId: '', quantity: '1', reason: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [b, t, p] = await Promise.all([
        api.get<{ items: Branch[] }>('/branches'),
        api.get<{ items: Transfer[] }>('/inventory/transfers', { params: { page: 1, limit: 20 } }),
        api.get<{ items: Product[] }>('/products', { params: { page: 1, limit: 100 } }),
      ]);
      const branchItems = await Promise.all((b.data.items || []).map(async (branch) => {
        const detail = await api.get<Branch>('/branches/' + branch._id);
        return detail.data;
      }));
      setBranches(branchItems); setTransfers(t.data.items || []); setProducts(p.data.items || []);
      if (!selected && b.data.items?.length) setSelected(b.data.items[0]._id);
    } catch { setError('Branch and warehouse data could not be loaded. Refresh and try again.'); }
    finally { setLoading(false); }
  }, [selected]);

  useEffect(() => { void load(); }, [load]);
  const activeBranch = branches.find(b => b._id === selected);
  const allWarehouses = branches.flatMap(b => (b.warehouses || []).filter(w => w.isActive).map(w => ({ ...w, branchName: b.name, branchId: b._id })));
  const selectedWarehouses = activeBranch?.warehouses || [];

  async function submitBranch(e: FormEvent) {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      await api.post('/branches', { ...branchForm, code: branchForm.code.trim().toUpperCase() });
      setBranchOpen(false); setBranchForm({ name: '', code: '', city: '', state: '', isPrimary: false }); await load();
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setFormError(Array.isArray(m) ? m.join(', ') : m || 'Branch could not be created.');
    } finally { setSaving(false); }
  }

  async function submitWarehouse(e: FormEvent) {
    e.preventDefault(); if (!activeBranch) return; setSaving(true); setFormError('');
    try {
      await api.post('/branches/' + activeBranch._id + '/warehouses', { ...warehouseForm, code: warehouseForm.code.trim().toUpperCase() });
      setWarehouseOpen(false); setWarehouseForm({ name: '', code: '', isDefault: false }); await load();
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setFormError(Array.isArray(m) ? m.join(', ') : m || 'Warehouse could not be created.');
    } finally { setSaving(false); }
  }

  async function submitTransfer(e: FormEvent) {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      await api.post('/inventory/transfers', { ...transferForm, quantity: Number(transferForm.quantity) });
      setTransferOpen(false); setTransferForm({ productId: '', sourceWarehouseId: '', destinationWarehouseId: '', quantity: '1', reason: '' }); await load();
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setFormError(Array.isArray(m) ? m.join(', ') : m || 'Warehouse transfer failed.');
    } finally { setSaving(false); }
  }

  async function archiveWarehouse(warehouse: WarehouseRecord) {
    if (!activeBranch || !window.confirm('Archive ' + warehouse.name + '? Warehouse must have zero stock.')) return;
    try { await api.delete('/branches/' + activeBranch._id + '/warehouses/' + warehouse._id); await load(); }
    catch (err: unknown) {
      const m = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setError(Array.isArray(m) ? m.join(', ') : m || 'Warehouse could not be archived.');
    }
  }

  return <div className="branches-page">
    <header className="branches-heading"><div><span>LOCATIONS & STOCK NETWORK</span><h1>Branches & Warehouses</h1><p>Manage business locations, warehouse stock points and controlled inter-location transfers.</p></div>
      <button className="branches-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
    {error && <div className="branches-error">{error}</div>}
    <div className="branches-layout">
      <section className="branches-card branches-list"><div className="branches-card-head"><div><h2>Business branches</h2><p>{branches.length} locations</p></div>{canManage && <button onClick={() => { setFormError(''); setBranchOpen(true); }}><Plus size={15}/> Add branch</button>}</div>
        {loading ? <p className="branches-empty">Loading branches...</p> : branches.length ? branches.map(b => <button key={b._id} className={'branches-list-item '+(selected===b._id?'selected':'')} onClick={() => setSelected(b._id)}>
          <Building2 size={18}/><span><strong>{b.name}</strong><small>{b.code} · {(b.warehouses||[]).length} warehouses</small></span>{b.isPrimary && <em>Primary</em>}
        </button>) : <p className="branches-empty">No branches yet. Create your first business location.</p>}
      </section>
      <section className="branches-card branches-detail">
        {activeBranch ? <>
          <div className="branches-card-head"><div><span className="branches-kicker">SELECTED LOCATION</span><h2>{activeBranch.name}</h2><p>{activeBranch.code} {activeBranch.city ? '· '+activeBranch.city : ''} {activeBranch.state ? '· '+activeBranch.state : ''}</p></div>
            {canManage && <button onClick={() => { setFormError(''); setWarehouseOpen(true); }}><Plus size={15}/> Add warehouse</button>}</div>
          <div className="branches-warehouse-grid">{selectedWarehouses.map(w => <article className="branches-warehouse" key={w._id}><div className="branches-warehouse-icon"><Warehouse size={19}/></div><div><strong>{w.name}</strong><small>{w.code} · {w.isActive?'Active':'Inactive'}</small></div>{w.isDefault && <em>Default</em>}{canManage && <button title="Archive warehouse" onClick={() => void archiveWarehouse(w)}><Archive size={15}/></button>}</article>)}
            {!selectedWarehouses.length && <p className="branches-empty">No warehouses in this branch. Add a warehouse to start allocating stock.</p>}</div>
          <div className="branches-transfer-head"><div><h3>Inter-warehouse transfers</h3><p>Transfers are recorded as paired stock ledger movements.</p></div>{canManage && allWarehouses.length>1 && <button onClick={() => { setFormError(''); setTransferOpen(true); }}><ArrowLeftRight size={15}/> New transfer</button>}</div>
        </> : <p className="branches-empty">Create a branch to configure warehouses.</p>}
      </section>
    </div>
    <section className="branches-card branches-transfer-ledger"><div className="branches-card-head"><div><h2>Transfer audit ledger</h2><p>Recent warehouse-to-warehouse movements</p></div><span>{transfers.length} recent</span></div>
      <div className="branches-table-wrap"><table><thead><tr><th>PRODUCT</th><th>FROM</th><th>TO</th><th>QUANTITY</th><th>REASON</th><th>DATE</th></tr></thead><tbody>
        {transfers.map(t=><tr key={t._id}><td>{label(t.productId)}</td><td>{label(t.sourceWarehouseId)}</td><td>{label(t.destinationWarehouseId)}</td><td>{t.quantity}</td><td>{t.reason}</td><td>{new Date(t.createdAt).toLocaleString('en-IN')}</td></tr>)}
        {!transfers.length && <tr><td colSpan={6} className="branches-empty">No transfers recorded yet.</td></tr>}
      </tbody></table></div>
    </section>

    {branchOpen && <div className="branches-backdrop"><form className="branches-modal" onSubmit={submitBranch}><h2>Create branch</h2><label>Branch name<input required minLength={2} maxLength={120} value={branchForm.name} onChange={e=>setBranchForm({...branchForm,name:e.target.value})}/></label><label>Branch code<input required maxLength={24} value={branchForm.code} onChange={e=>setBranchForm({...branchForm,code:e.target.value})}/></label><div className="branches-form-grid"><label>City<input maxLength={100} value={branchForm.city} onChange={e=>setBranchForm({...branchForm,city:e.target.value})}/></label><label>State<input maxLength={100} value={branchForm.state} onChange={e=>setBranchForm({...branchForm,state:e.target.value})}/></label></div><label className="branches-check"><input type="checkbox" checked={branchForm.isPrimary} onChange={e=>setBranchForm({...branchForm,isPrimary:e.target.checked})}/> Set as primary branch</label>{formError&&<p className="branches-error">{formError}</p>}<footer><button type="button" onClick={()=>setBranchOpen(false)}>Cancel</button><button disabled={saving}>{saving?'Saving...':'Create branch'}</button></footer></form></div>}
    {warehouseOpen && <div className="branches-backdrop"><form className="branches-modal" onSubmit={submitWarehouse}><h2>Add warehouse to {activeBranch?.name}</h2><label>Warehouse name<input required minLength={2} maxLength={120} value={warehouseForm.name} onChange={e=>setWarehouseForm({...warehouseForm,name:e.target.value})}/></label><label>Warehouse code<input required maxLength={24} value={warehouseForm.code} onChange={e=>setWarehouseForm({...warehouseForm,code:e.target.value})}/></label><label className="branches-check"><input type="checkbox" checked={warehouseForm.isDefault} onChange={e=>setWarehouseForm({...warehouseForm,isDefault:e.target.checked})}/> Set as default warehouse</label>{formError&&<p className="branches-error">{formError}</p>}<footer><button type="button" onClick={()=>setWarehouseOpen(false)}>Cancel</button><button disabled={saving}>{saving?'Saving...':'Create warehouse'}</button></footer></form></div>}
    {transferOpen && <div className="branches-backdrop"><form className="branches-modal" onSubmit={submitTransfer}><h2>Transfer stock</h2><label>Product<select required value={transferForm.productId} onChange={e=>setTransferForm({...transferForm,productId:e.target.value})}><option value="">Select product</option>{products.map(p=><option key={p._id} value={p._id}>{p.name} {p.sku?'· '+p.sku:''}</option>)}</select></label><label>Source warehouse<select required value={transferForm.sourceWarehouseId} onChange={e=>setTransferForm({...transferForm,sourceWarehouseId:e.target.value})}><option value="">Select source</option>{allWarehouses.map(w=><option key={w._id} value={w._id}>{w.branchName} · {w.name}</option>)}</select></label><label>Destination warehouse<select required value={transferForm.destinationWarehouseId} onChange={e=>setTransferForm({...transferForm,destinationWarehouseId:e.target.value})}><option value="">Select destination</option>{allWarehouses.filter(w=>w._id!==transferForm.sourceWarehouseId).map(w=><option key={w._id} value={w._id}>{w.branchName} · {w.name}</option>)}</select></label><label>Quantity<input required type="number" min="1" step="1" value={transferForm.quantity} onChange={e=>setTransferForm({...transferForm,quantity:e.target.value})}/></label><label>Reason / reference<input required minLength={3} maxLength={250} value={transferForm.reason} onChange={e=>setTransferForm({...transferForm,reason:e.target.value})}/></label>{formError&&<p className="branches-error">{formError}</p>}<footer><button type="button" onClick={()=>setTransferOpen(false)}>Cancel</button><button disabled={saving}>{saving?'Transferring...':'Confirm transfer'}</button></footer></form></div>}
  </div>;
}
