import { useCallback, useEffect, useState } from 'react';
import { BadgePercent, CalendarClock, Pause, Play, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import './PromotionsPage.css';

type Promotion = {
  _id: string; code: string; name: string; description: string;
  discountType: 'PERCENT' | 'FIXED'; discountValue: number;
  minimumSubtotal: number; maximumDiscount?: number | null;
  startsAt: string; endsAt: string; usageLimit?: number | null;
  usageCount: number; status: 'ACTIVE' | 'PAUSED' | 'EXPIRED';
};
type PromotionForm = {
  code: string; name: string; description: string; discountType: 'PERCENT' | 'FIXED';
  discountValue: string; minimumSubtotal: string; maximumDiscount: string;
  startsAt: string; endsAt: string; usageLimit: string;
};
const empty: PromotionForm = {
  code: '', name: '', description: '', discountType: 'PERCENT', discountValue: '10',
  minimumSubtotal: '0', maximumDiscount: '', startsAt: '', endsAt: '', usageLimit: '',
};
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const localInput = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export default function PromotionsPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const [items, setItems] = useState<Promotion[]>([]);
  const [form, setForm] = useState<PromotionForm>(empty);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await api.get<Promotion[]>('/sales/promotions'); setItems(response.data || []); }
    catch { setError('Promotions could not be loaded. Refresh and try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try {
      await api.post('/sales/promotions', {
        ...form, code: form.code.trim().toUpperCase(),
        discountValue: Number(form.discountValue),
        minimumSubtotal: Number(form.minimumSubtotal || 0),
        ...(form.maximumDiscount ? { maximumDiscount: Number(form.maximumDiscount) } : {}),
        startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(),
        ...(form.usageLimit ? { usageLimit: Number(form.usageLimit) } : {}),
      });
      setForm(empty); setFormOpen(false); setSuccess('Promotion created successfully.'); await load();
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : message || 'Promotion could not be created.');
    } finally { setSaving(false); }
  }

  async function toggle(item: Promotion) {
    setError(''); setSuccess('');
    try {
      await api.patch('/sales/promotions/' + item._id + '/status', { status: item.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
      setSuccess(item.status === 'ACTIVE' ? 'Promotion paused.' : 'Promotion activated.'); await load();
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : message || 'Promotion status could not be updated.');
    }
  }

  return <div className="promotions-page">
    <div className="promotions-heading"><div><span className="promotions-eyebrow">CAMPAIGNS & PRICING</span><h1>Promotions</h1><p>Create controlled discount codes for POS billing and track usage.</p></div>
      <div className="promotions-actions"><button className="promotions-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Refresh</button>{canManage && <button className="promotions-primary" onClick={() => { setForm(empty); setForm({ ...empty, startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 7 * 86400000)) }); setFormOpen(true); }}><Plus size={17}/> Create promotion</button>}</div>
    </div>
    {error && <div className="promotions-alert">{error}</div>}{success && <div className="promotions-success">{success}</div>}
    <div className="promotions-grid">{items.map(item => <article className="promotion-card" key={item._id}>
      <div className="promotion-card-top"><span className={'promotion-status status-' + item.status.toLowerCase()}>{item.status}</span><BadgePercent size={20}/></div>
      <span className="promotion-code">{item.code}</span><h2>{item.name}</h2><p>{item.description || 'POS campaign discount'}</p>
      <strong className="promotion-value">{item.discountType === 'PERCENT' ? item.discountValue + '% OFF' : money(item.discountValue) + ' OFF'}</strong>
      <div className="promotion-meta"><span>Minimum bill {money(item.minimumSubtotal)}</span>{item.maximumDiscount != null && <span>Max saving {money(item.maximumDiscount)}</span>}</div>
      <div className="promotion-usage"><span>Usage</span><strong>{item.usageCount}{item.usageLimit ? ' / ' + item.usageLimit : ' · unlimited'}</strong></div>
      <div className="promotion-dates"><CalendarClock size={14}/><span>{new Date(item.startsAt).toLocaleDateString('en-IN')} – {new Date(item.endsAt).toLocaleDateString('en-IN')}</span></div>
      {canManage && item.status !== 'EXPIRED' && <button className="promotion-toggle" onClick={() => void toggle(item)}>{item.status === 'ACTIVE' ? <><Pause size={15}/> Pause campaign</> : <><Play size={15}/> Activate campaign</>}</button>}
    </article>)}
    {!loading && !items.length && <div className="promotions-empty"><BadgePercent size={28}/><strong>No promotions created</strong><span>Create your first promotion to offer controlled POS discounts.</span></div>}</div>
    {formOpen && <div className="promotions-backdrop" onClick={() => !saving && setFormOpen(false)}><form className="promotions-form" onSubmit={event => void save(event)} onClick={event => event.stopPropagation()}>
      <header><div><span className="promotions-eyebrow">NEW CAMPAIGN</span><h2>Create promotion</h2><p>Promotion rules are validated again during invoice creation.</p></div><button type="button" onClick={() => setFormOpen(false)}>×</button></header>
      <div className="promotions-form-grid">
        <label>Campaign code *<input required minLength={3} maxLength={40} value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="FESTIVE10"/></label>
        <label>Campaign name *<input required minLength={2} maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Festive savings"/></label>
        <label>Discount type<select value={form.discountType} onChange={e => setForm({ ...form, discountType: e.target.value as 'PERCENT' | 'FIXED' })}><option value="PERCENT">Percentage</option><option value="FIXED">Fixed amount (₹)</option></select></label>
        <label>Discount value *<input required type="number" min=".01" step=".01" max={form.discountType === 'PERCENT' ? 100 : undefined} value={form.discountValue} onChange={e => setForm({ ...form, discountValue: e.target.value })}/></label>
        <label>Minimum bill (₹)<input type="number" min="0" step=".01" value={form.minimumSubtotal} onChange={e => setForm({ ...form, minimumSubtotal: e.target.value })}/></label>
        <label>Maximum discount (₹)<input type="number" min=".01" step=".01" value={form.maximumDiscount} onChange={e => setForm({ ...form, maximumDiscount: e.target.value })} placeholder="No cap"/></label>
        <label>Starts at *<input required type="datetime-local" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })}/></label>
        <label>Ends at *<input required type="datetime-local" value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })}/></label>
        <label>Maximum uses<input type="number" min="1" step="1" value={form.usageLimit} onChange={e => setForm({ ...form, usageLimit: e.target.value })} placeholder="Unlimited"/></label>
        <label className="promotion-wide">Description<input maxLength={500} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional campaign details"/></label>
      </div>
      <footer><button type="button" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create promotion'}</button></footer>
    </form></div>}
  </div>;
}
