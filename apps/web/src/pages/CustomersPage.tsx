import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Search, RefreshCw, Plus, Users, X, Eye, Pencil, ChevronLeft,
  ChevronRight, Phone, Mail, MapPin, FileText,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import './CustomersPage.css';

type Customer = {
  _id: string; name: string; phone?: string; email?: string; gstin?: string;
  addressLine1?: string; addressLine2?: string; city?: string; state?: string;
  pincode?: string; notes?: string; createdAt?: string; loyaltyPoints?: number; lifetimeLoyaltyPoints?: number; loyaltyTier?: string;
};
type CustomerListResponse = {
  items: Customer[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
};
type Sale = {
  _id: string; invoiceNumber: string; invoiceDate: string; grandTotal: number;
  paidAmount: number; dueAmount: number; paymentStatus: string; status: string;
};
type HistoryResponse = {
  items: Sale[];
  summary: { invoiceCount: number; totalBilled: number; totalPaid: number; totalDue: number };
  pagination: { total: number; page: number; limit: number; totalPages: number };
};
type LoyaltyEntry = { _id: string; eventType: string; pointsDelta: number; balanceAfter: number; reason: string; createdAt: string };
type LoyaltyResponse = { customer: { pointsBalance: number; lifetimePoints: number; tier: string; nextTier: { tier: string; pointsRequired: number } | null }; items: LoyaltyEntry[]; earningRule: string };
type CustomerForm = {
  name: string; phone: string; email: string; gstin: string; addressLine1: string;
  addressLine2: string; city: string; state: string; pincode: string; notes: string;
};
const emptyForm: CustomerForm = {
  name: '', phone: '', email: '', gstin: '', addressLine1: '', addressLine2: '',
  city: '', state: '', pincode: '', notes: '',
};
const money = (value = 0) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
}).format(Number(value) || 0);
const date = (value?: string) => value ? new Date(value).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric',
}) : '—';
const optional = (value: string) => value.trim() || undefined;

export default function CustomersPage() {
  const { user } = useAuth();
  const canManageCustomers = user?.role === 'owner' || user?.role === 'admin';
  const [data, setData] = useState<CustomerListResponse | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loyalty, setLoyalty] = useState<LoyaltyResponse | null>(null);
  const [loyaltyAdjustOpen, setLoyaltyAdjustOpen] = useState(false);
  const [loyaltyDelta, setLoyaltyDelta] = useState('');
  const [loyaltyReason, setLoyaltyReason] = useState('');
  const [loyaltySaving, setLoyaltySaving] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState('');

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<CustomerListResponse>('/customers', {
        params: { page, limit: 20, ...(search.trim() ? { search: search.trim() } : {}) },
      });
      setData(response.data);
    } catch {
      setError('Customer records could not be loaded. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCustomers(), 250);
    return () => window.clearTimeout(timer);
  }, [loadCustomers]);

  function startCreate() {
    setEditing(null); setForm(emptyForm); setFormError(''); setFormOpen(true);
  }
  function startEdit(customer: Customer) {
    setEditing(customer);
    setForm({
      name: customer.name || '', phone: customer.phone || '', email: customer.email || '',
      gstin: customer.gstin || '', addressLine1: customer.addressLine1 || '',
      addressLine2: customer.addressLine2 || '', city: customer.city || '',
      state: customer.state || '', pincode: customer.pincode || '', notes: customer.notes || '',
    });
    setFormError(''); setFormOpen(true);
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError('');
    const payload = {
      name: form.name.trim(), phone: optional(form.phone), email: optional(form.email),
      gstin: optional(form.gstin.toUpperCase()), addressLine1: optional(form.addressLine1),
      addressLine2: optional(form.addressLine2), city: optional(form.city),
      state: optional(form.state), pincode: optional(form.pincode), notes: optional(form.notes),
    };
    try {
      if (editing) await api.patch('/customers/' + editing._id, payload);
      else await api.post('/customers', payload);
      setFormOpen(false); await loadCustomers();
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } })
        .response?.data?.message;
      setFormError(Array.isArray(message) ? message.join(', ') : message || 'Customer could not be saved. Check the details and try again.');
    } finally { setSaving(false); }
  }

  async function openDetails(customer: Customer, nextPage = 1) {
    setSelected(customer); setHistory(null); setLoyalty(null); setHistoryPage(nextPage); setDetailLoading(true);
    try {
      const [customerResponse, historyResponse, loyaltyResponse] = await Promise.all([
        api.get<Customer>('/customers/' + customer._id),
        api.get<HistoryResponse>('/customers/' + customer._id + '/sales', {
          params: { page: nextPage, limit: 8 },
        }),
        api.get<LoyaltyResponse>('/customers/' + customer._id + '/loyalty', { params: { page: 1, limit: 8 } }),
      ]);
      setSelected(customerResponse.data); setHistory(historyResponse.data); setLoyalty(loyaltyResponse.data);
    } catch { setHistory(null); }
    finally { setDetailLoading(false); }
  }

  async function adjustLoyalty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setLoyaltySaving(true); setLoyaltyError('');
    try {
      await api.post('/customers/' + selected._id + '/loyalty/adjust', { pointsDelta: Number(loyaltyDelta), reason: loyaltyReason.trim() });
      const response = await api.get<LoyaltyResponse>('/customers/' + selected._id + '/loyalty', { params: { page: 1, limit: 8 } });
      setLoyalty(response.data); setLoyaltyAdjustOpen(false); setLoyaltyDelta(''); setLoyaltyReason('');
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setLoyaltyError(Array.isArray(message) ? message.join(', ') : message || 'Points adjustment could not be saved.');
    } finally { setLoyaltySaving(false); }
  }

  const customers = data?.items ?? [];
  const total = data?.pagination.total ?? 0;

  return (
    <div className="customers-page">
      <div className="customers-heading">
        <div><span className="customers-eyebrow">RELATIONSHIPS & ACCOUNTS</span>
          <h1>Customers</h1>
          <p>Manage customer details, review purchase history and follow outstanding balances.</p>
        </div>
        <div className="customers-heading-actions">
          <button className="customers-refresh" onClick={() => void loadCustomers()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'customers-spin' : ''} /> Refresh
          </button>
          {canManageCustomers && <button className="customers-primary" onClick={startCreate}><Plus size={17} /> Add customer</button>}
        </div>
      </div>

      <div className="customers-overview">
        <div className="customers-overview-card"><span className="customers-overview-icon"><Users size={18} /></span>
          <div><small>Customers in workspace</small><strong>{loading && !data ? '—' : total.toLocaleString('en-IN')}</strong></div>
        </div>
        <div className="customers-overview-card"><span className="customers-overview-icon"><FileText size={18} /></span>
          <div><small>On this page</small><strong>{customers.length}</strong></div>
        </div>
        <div className="customers-overview-note">Customer balances are calculated from issued invoices and shown in each customer’s account.</div>
      </div>

      <div className="customers-toolbar">
        <div className="customers-search"><Search size={18} />
          <input value={search} placeholder="Search name, phone, email or GSTIN..."
            onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          {search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={16} /></button>}
        </div>
        <span>{total.toLocaleString('en-IN')} customer{total === 1 ? '' : 's'}</span>
      </div>

      {error && <div className="customers-error">{error}</div>}
      <div className="customers-table-card"><div className="customers-table-wrap">
        <table className="customers-table"><thead><tr><th>CUSTOMER</th><th>CONTACT</th><th>LOCATION</th><th>GSTIN</th><th>ADDED</th><th></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="customers-empty">Loading customer records...</td></tr> :
              customers.length === 0 ? <tr><td colSpan={6} className="customers-empty">
                <Users size={32} /><strong>{search ? 'No matching customers' : 'No customers yet'}</strong>
                <span>{search ? 'Try a different name, phone or GSTIN.' : 'Add your first customer to start building your customer book.'}</span>
                {!search && canManageCustomers && <button className="customers-empty-action" onClick={startCreate}><Plus size={15} /> Add first customer</button>}
              </td></tr> : customers.map((customer) => (
                <tr key={customer._id}>
                  <td><button className="customers-name-button" onClick={() => void openDetails(customer)}>{customer.name}</button>
                    <small className="customers-id">Customer since {date(customer.createdAt)}</small></td>
                  <td>{customer.phone && <span className="customers-contact"><Phone size={13} />{customer.phone}</span>}
                    {customer.email && <span className="customers-contact"><Mail size={13} />{customer.email}</span>}
                    {!customer.phone && !customer.email && <span className="customers-muted">No contact details</span>}</td>
                  <td>{[customer.city, customer.state].filter(Boolean).join(', ') || <span className="customers-muted">—</span>}</td>
                  <td>{customer.gstin || <span className="customers-muted">—</span>}</td>
                  <td>{date(customer.createdAt)}</td>
                  <td><div className="customers-row-actions">
                    <button title="View account" aria-label="View account" onClick={() => void openDetails(customer)}><Eye size={16} /></button>
                    {canManageCustomers && <button title="Edit customer" aria-label="Edit customer" onClick={() => startEdit(customer)}><Pencil size={16} /></button>}
                  </div></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="customers-pagination">
        <span>{total ? 'Showing ' + ((page - 1) * 20 + 1) + '–' + Math.min(page * 20, total) + ' of ' + total : 'No records'}</span>
        <div>
          <button disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} /> Previous</button>
          <span>Page {data?.pagination.page ?? page} of {Math.max(data?.pagination.totalPages ?? 1, 1)}</span>
          <button disabled={!data || page >= data.pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={16} /></button>
        </div>
      </div></div>

      {formOpen && <div className="customers-modal-backdrop" onClick={() => !saving && setFormOpen(false)}>
        <section className="customers-form-modal" onClick={(event) => event.stopPropagation()}>
          <div className="customers-modal-header"><div><span className="customers-eyebrow">CUSTOMER DIRECTORY</span>
            <h2>{editing ? 'Edit customer' : 'Add customer'}</h2><p>Keep customer details ready for faster billing.</p></div>
            <button className="customers-icon-button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Close"><X size={20} /></button>
          </div>
          <form onSubmit={(event) => void saveCustomer(event)}>
            <div className="customers-form-grid">
              <label className="customers-field customers-field-wide">Customer name *<input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Rahul Sharma" /></label>
              <label className="customers-field">Phone number<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+91 98765 43210" /></label>
              <label className="customers-field">Email address<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@example.com" /></label>
              <label className="customers-field customers-field-wide">GSTIN<input maxLength={15} value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.target.value.toUpperCase() })} placeholder="15-character GSTIN (optional)" /></label>
              <label className="customers-field customers-field-wide">Address line 1<input maxLength={200} value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} /></label>
              <label className="customers-field customers-field-wide">Address line 2<input maxLength={200} value={form.addressLine2} onChange={(event) => setForm({ ...form, addressLine2: event.target.value })} /></label>
              <label className="customers-field">City<input maxLength={100} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
              <label className="customers-field">State<input maxLength={100} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></label>
              <label className="customers-field">PIN code<input maxLength={10} value={form.pincode} onChange={(event) => setForm({ ...form, pincode: event.target.value })} /></label>
              <label className="customers-field customers-field-wide">Notes<textarea rows={3} maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional notes for your team" /></label>
            </div>
            {formError && <div className="customers-error">{formError}</div>}
            <div className="customers-form-footer">
              <button type="button" className="customers-secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
              <button type="submit" className="customers-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create customer'}</button>
            </div>
          </form>
        </section>
      </div>}

      {selected && <div className="customers-modal-backdrop" onClick={() => setSelected(null)}>
        <section className="customers-detail-modal" onClick={(event) => event.stopPropagation()}>
          <div className="customers-modal-header"><div><span className="customers-eyebrow">CUSTOMER ACCOUNT</span>
            <h2>{selected.name}</h2><p>Customer profile and purchase activity</p></div>
            <div className="customers-detail-actions">
              {canManageCustomers && <button className="customers-secondary" onClick={() => { setSelected(null); startEdit(selected); }}><Pencil size={15} /> Edit</button>}
              <button className="customers-icon-button" onClick={() => setSelected(null)} aria-label="Close"><X size={20} /></button>
            </div>
          </div>
          <div className="customers-profile-grid">
            <div><Phone size={15} /><span>{selected.phone || 'No phone added'}</span></div>
            <div><Mail size={15} /><span>{selected.email || 'No email added'}</span></div>
            <div><MapPin size={15} /><span>{[selected.addressLine1, selected.addressLine2, selected.city, selected.state, selected.pincode].filter(Boolean).join(', ') || 'No address added'}</span></div>
            <div><FileText size={15} /><span>{selected.gstin ? 'GSTIN: ' + selected.gstin : 'No GSTIN added'}</span></div>
          </div>
          <div className="customers-account-summary">
            <div><small>Invoices</small><strong>{history?.summary.invoiceCount ?? '—'}</strong></div>
            <div><small>Total billed</small><strong>{money(history?.summary.totalBilled)}</strong></div>
            <div><small>Collected</small><strong>{money(history?.summary.totalPaid)}</strong></div>
            <div className="customers-balance-card"><small>Outstanding</small><strong>{money(history?.summary.totalDue)}</strong></div>
          </div>
          <div className="customers-history-heading"><div><h3>Purchase history</h3><p>Invoices issued to this customer</p></div><span>{history?.pagination.total ?? 0} invoices</span></div>
          {detailLoading ? <div className="customers-history-empty">Loading customer account...</div> :
            history?.items.length ? <div className="customers-history-table-wrap">
              <table className="customers-history-table"><thead><tr><th>INVOICE</th><th>DATE</th><th>STATUS</th><th>TOTAL</th><th>PAID</th><th>DUE</th></tr></thead>
                <tbody>{history.items.map((sale) => <tr key={sale._id}>
                  <td>{sale.invoiceNumber}</td><td>{date(sale.invoiceDate)}</td>
                  <td><span className={'customers-invoice-status ' + (sale.status === 'CANCELLED' ? 'is-cancelled' : 'is-issued')}>{sale.status === 'CANCELLED' ? 'Cancelled' : sale.paymentStatus.replaceAll('_', ' ')}</span></td>
                  <td>{money(sale.grandTotal)}</td><td>{money(sale.paidAmount)}</td><td className="customers-due">{money(sale.dueAmount)}</td>
                </tr>)}</tbody>
              </table>
            </div> : <div className="customers-history-empty">{history ? 'No invoices have been issued to this customer yet.' : 'Purchase history could not be loaded.'}</div>}
          <div className="customers-detail-footer"><span>{history?.pagination.total ? 'Page ' + historyPage + ' of ' + history.pagination.totalPages : ' '}</span>
            <div>
              <button className="customers-secondary" disabled={historyPage <= 1 || detailLoading} onClick={() => void openDetails(selected, historyPage - 1)}><ChevronLeft size={15} /> Previous</button>
              <button className="customers-secondary" disabled={!history || historyPage >= history.pagination.totalPages || detailLoading} onClick={() => void openDetails(selected, historyPage + 1)}>Next <ChevronRight size={15} /></button>
            </div>
          </div>
        </section>
      </div>}
    </div>
  );
}
