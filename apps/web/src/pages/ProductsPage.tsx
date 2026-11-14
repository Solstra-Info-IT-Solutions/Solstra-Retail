import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Search, RefreshCw, Plus, Package, AlertTriangle, Boxes, X, Eye, Pencil,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import './ProductsPage.css';

type Product = {
  _id: string; name: string; description?: string; category?: string; sku?: string;
  barcode?: string; purchasePrice: number; sellingPrice: number; mrp: number;
  priceIncludesTax?: boolean; gstRate: number; hsnCode?: string; unit?: string;
  stockQty: number; lowStockThreshold: number; trackStock: boolean; warrantyDays?: number; warrantyTerms?: string; valuationInitialized?: boolean; averageCost?: number; inventoryValue?: number; createdAt?: string;
};
type ProductList = {
  items: Product[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
};
type LowStockList = { items: Product[]; total: number };
type ValuationStatus = { summary: { trackedProducts: number; initializedProducts: number; pendingProducts: number; pendingStockUnits: number; completionPercentage: number }; items: Product[]; pagination: { total: number } };
type ProductForm = {
  name: string; description: string; category: string; sku: string; barcode: string;
  purchasePrice: string; sellingPrice: string; mrp: string; gstRate: string;
  hsnCode: string; unit: string; stockQty: string; lowStockThreshold: string;
  trackStock: boolean; priceIncludesTax: boolean; warrantyDays: string; warrantyTerms: string;
};
const blankForm: ProductForm = {
  name: '', description: '', category: '', sku: '', barcode: '',
  purchasePrice: '0', sellingPrice: '0', mrp: '0', gstRate: '18',
  hsnCode: '', unit: 'pcs', stockQty: '0', lowStockThreshold: '5',
  trackStock: true, priceIncludesTax: false, warrantyDays: '0', warrantyTerms: '',
};
const money = (value = 0) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
}).format(Number(value) || 0);
const optional = (value: string) => value.trim() || undefined;

function parseImportCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"' && quoted && source[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell.trim()); if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim()); if (row.some(value => value !== '')) rows.push(row);
  if (quoted || rows.length < 2) throw new Error('CSV must contain a header and at least one product row.');
  const headers = rows[0].map(value => value.replace(/^\uFEFF/, '').trim());
  const required = ['name', 'purchasePrice', 'sellingPrice', 'mrp'];
  if (required.some(key => !headers.includes(key))) throw new Error('CSV headers must include name, purchasePrice, sellingPrice and mrp.');
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export default function ProductsPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const [data, setData] = useState<ProductList | null>(null);
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [valuation, setValuation] = useState<ValuationStatus | null>(null);
  const [valuationCosts, setValuationCosts] = useState<Record<string, string>>({});
  const [valuationReasons, setValuationReasons] = useState<Record<string, string>>({});
  const [valuationSaving, setValuationSaving] = useState('');
  const [importRows, setImportRows] = useState<Record<string, unknown>[]>([]);
  const [importPreview, setImportPreview] = useState<{totalRows:number;validRows:number;invalidRows:number;rows:Array<{rowNumber:number;valid:boolean;errors:string[]}>;note:string}|null>(null);
  const [importMessage, setImportMessage] = useState('');
  const [importBusy, setImportBusy] = useState(false);


  const loadProducts = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [productsResponse, lowStockResponse, valuationResponse] = await Promise.all([
        api.get<ProductList>('/products', {
          params: { page, limit: 20, ...(search.trim() ? { search: search.trim() } : {}) },
        }),
        api.get<LowStockList>('/products/low-stock'),
        canManage ? api.get<ValuationStatus>('/products/valuation-status', { params: { page: 1, limit: 50 } }) : Promise.resolve({ data: null } as { data: null }),
      ]);
      setData(productsResponse.data);
      setLowStockCount(lowStockResponse.data.total);
      setValuation(valuationResponse.data);
    } catch {
      setError('Product records could not be loaded. Please refresh and try again.');
    } finally { setLoading(false); }
  }, [page, search, canManage]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProducts(), 250);
    return () => window.clearTimeout(timer);
  }, [loadProducts]);

  function openCreate() {
    setEditing(null); setForm(blankForm); setFormError(''); setFormOpen(true);
  }
  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      name: product.name || '', description: product.description || '',
      category: product.category || '', sku: product.sku || '',
      barcode: product.barcode || '', purchasePrice: String(product.purchasePrice ?? 0),
      sellingPrice: String(product.sellingPrice ?? 0), mrp: String(product.mrp ?? 0),
      gstRate: String(product.gstRate ?? 18), hsnCode: product.hsnCode || '',
      unit: product.unit || 'pcs', stockQty: String(product.stockQty ?? 0),
      lowStockThreshold: String(product.lowStockThreshold ?? 5),
      trackStock: product.trackStock !== false, priceIncludesTax: product.priceIncludesTax === true,
      warrantyDays: String(product.warrantyDays ?? 0), warrantyTerms: product.warrantyTerms || '',
    });
    setFormError(''); setFormOpen(true);
  }
  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError('');
    const payload = {
      name: form.name.trim(), description: optional(form.description),
      category: optional(form.category), sku: optional(form.sku.toUpperCase()),
      barcode: optional(form.barcode), purchasePrice: Number(form.purchasePrice),
      sellingPrice: Number(form.sellingPrice), mrp: Number(form.mrp),
      gstRate: Number(form.gstRate), hsnCode: optional(form.hsnCode),
      unit: form.unit.trim() || 'pcs', lowStockThreshold: Number(form.lowStockThreshold),
      trackStock: form.trackStock, priceIncludesTax: form.priceIncludesTax,
      warrantyDays: Number(form.warrantyDays), warrantyTerms: optional(form.warrantyTerms),
      ...(!editing ? { stockQty: Number(form.stockQty) } : {}),
    };
    try {
      if (editing) await api.patch('/products/' + editing._id, payload);
      else await api.post('/products', payload);
      setFormOpen(false); await loadProducts();
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } })
        .response?.data?.message;
      setFormError(Array.isArray(message) ? message.join(', ') : message || 'Product could not be saved. Check SKU/barcode uniqueness and field values.');
    } finally { setSaving(false); }
  }

  async function previewCatalogueImport(file?: File) {
    if (!file) return;
    setImportBusy(true); setImportMessage(''); setImportPreview(null);
    try {
      const rows = parseImportCsv(await file.text());
      const response = await api.post('/products/import/preview', { rows });
      setImportRows(rows); setImportPreview(response.data);
    } catch (error: unknown) {
      const message = (error as {response?:{data?:{message?:string|string[]}}}).response?.data?.message;
      setImportMessage(Array.isArray(message) ? message.join(', ') : message || (error instanceof Error ? error.message : 'CSV preview failed.'));
    } finally { setImportBusy(false); }
  }
  async function commitCatalogueImport() {
    if (!importRows.length || !importPreview?.validRows) return;
    setImportBusy(true); setImportMessage('');
    try {
      const response = await api.post('/products/import/commit', { rows: importRows });
      setImportMessage(`Import finished: ${response.data.createdCount} created, ${response.data.failedCount} failed. Opening stock was not imported.`);
      setImportPreview(null); setImportRows([]); await loadProducts();
    } catch (error: unknown) {
      const message = (error as {response?:{data?:{message?:string|string[]}}}).response?.data?.message;
      setImportMessage(Array.isArray(message) ? message.join(', ') : message || 'Catalogue import failed.');
    } finally { setImportBusy(false); }
  }

  async function initializeValuation(product: Product) {
    const unitCost = Number(valuationCosts[product._id]);
    const reason = (valuationReasons[product._id] || '').trim();
    if (!Number.isFinite(unitCost) || unitCost < 0 || !reason || reason.length < 3) {
      setError('Enter a verified non-negative unit cost and a reconciliation reason (at least 3 characters).');
      return;
    }
    setValuationSaving(product._id); setError('');
    try {
      await api.post('/products/' + product._id + '/initialize-valuation', { unitCost, reason });
      setValuationCosts(old => ({ ...old, [product._id]: '' }));
      setValuationReasons(old => ({ ...old, [product._id]: '' }));
      await loadProducts();
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : message || 'Valuation could not be initialized.');
    } finally { setValuationSaving(''); }
  }

  const products = data?.items ?? [];
  const total = data?.pagination.total ?? 0;
  const trackedProducts = products.filter((item) => item.trackStock).length;

  return (
    <div className="products-page">
      <div className="products-heading">
        <div><span className="products-eyebrow">CATALOGUE & STOCK CONTROL</span>
          <h1>Products</h1><p>Manage your items, pricing, tax details and stock thresholds.</p></div>
        <div className="products-heading-actions">
          <button className="products-refresh" onClick={() => void loadProducts()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'products-spin' : ''} /> Refresh
          </button>
          {canManage && <button className="products-primary" onClick={openCreate}><Plus size={17} /> Add product</button>}
        </div>
      </div>

      <div className="products-overview">
        <div className="products-metric"><span className="products-metric-icon"><Package size={18} /></span>
          <div><small>Products in catalogue</small><strong>{loading && !data ? '—' : total.toLocaleString('en-IN')}</strong></div></div>
        <div className="products-metric"><span className="products-metric-icon"><AlertTriangle size={18} /></span>
          <div><small>Low stock items</small><strong>{lowStockCount === null ? '—' : lowStockCount.toLocaleString('en-IN')}</strong></div></div>
        <div className="products-metric"><span className="products-metric-icon"><Boxes size={18} /></span>
          <div><small>Stock-tracked on this page</small><strong>{trackedProducts}</strong></div></div>
      </div>

      <div className="products-toolbar">
        <div className="products-search"><Search size={18} />
          <input value={search} placeholder="Search product, SKU, barcode or category..."
            onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          {search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={16} /></button>}
        </div>
        <span>{total.toLocaleString('en-IN')} product{total === 1 ? '' : 's'}</span>
      </div>
      {canManage && <section className="products-import-card">
        <div><strong>Import product catalogue</strong><p>Upload CSV with name, purchasePrice, sellingPrice and mrp. Opening stock is deliberately excluded.</p></div>
        <label className="products-secondary">Choose CSV<input type="file" accept=".csv,text/csv" disabled={importBusy} onChange={event=>{void previewCatalogueImport(event.target.files?.[0]);event.target.value='';}}/></label>
        {importBusy && <span>Processing import…</span>}
        {importPreview && <div className="products-import-preview"><b>{importPreview.validRows} valid · {importPreview.invalidRows} need correction · {importPreview.totalRows} rows</b>{importPreview.rows.filter(row=>!row.valid).slice(0,5).map(row=><small key={row.rowNumber}>Row {row.rowNumber}: {row.errors.join('; ')}</small>)}<button className="products-primary" onClick={()=>void commitCatalogueImport()} disabled={importBusy||!importPreview.validRows}>Import valid rows</button></div>}
        {importMessage && <p className="products-stock-note">{importMessage}</p>}
      </section>}
      {error && <div className="products-error">{error}</div>}

      <div className="products-table-card"><div className="products-table-wrap">
        <table className="products-table"><thead><tr>
          <th>PRODUCT</th><th>SKU / BARCODE</th><th>CATEGORY</th><th>SELLING PRICE</th><th>STOCK</th><th>GST</th><th></th>
        </tr></thead><tbody>
          {loading ? <tr><td colSpan={7} className="products-empty">Loading product catalogue...</td></tr> :
            products.length === 0 ? <tr><td colSpan={7} className="products-empty">
              <Package size={32} /><strong>{search ? 'No matching products' : 'Your catalogue is ready for its first product'}</strong>
              <span>{search ? 'Try a different product name, SKU or barcode.' : 'Add products to make billing and stock tracking faster.'}</span>
              {!search && canManage && <button className="products-empty-action" onClick={openCreate}><Plus size={15} /> Add first product</button>}
            </td></tr> : products.map((product) => {
              const isLow = product.trackStock && product.stockQty <= product.lowStockThreshold;
              return <tr key={product._id}>
                <td><button className="products-name" onClick={() => setSelected(product)}>{product.name}</button>
                  <small className="products-description">{product.description || product.unit || 'Product'}</small></td>
                <td><span className="products-code">{product.sku || '—'}</span>
                  {product.barcode && <small className="products-description">{product.barcode}</small>}</td>
                <td>{product.category || <span className="products-muted">Uncategorised</span>}</td>
                <td><strong className="products-price">{money(product.sellingPrice)}</strong>
                  <small className="products-description">MRP {money(product.mrp)}</small></td>
                <td>{product.trackStock ? <span className={'products-stock ' + (isLow ? 'is-low' : 'is-healthy')}>
                  {isLow && <AlertTriangle size={12} />}{product.stockQty} {product.unit || 'pcs'}
                </span> : <span className="products-muted">Not tracked</span>}</td>
                <td><span className="products-tax">{product.gstRate}%</span></td>
                <td><div className="products-row-actions">
                  <button title="View product" aria-label="View product" onClick={() => setSelected(product)}><Eye size={16} /></button>
                  {canManage && <button title="Edit product" aria-label="Edit product" onClick={() => openEdit(product)}><Pencil size={16} /></button>}
                </div></td>
              </tr>;
            })}
        </tbody></table>
      </div>
      <div className="products-pagination"><span>{total ? 'Showing ' + ((page - 1) * 20 + 1) + '–' + Math.min(page * 20, total) + ' of ' + total : 'No records'}</span>
        <div><button disabled={page <= 1 || loading} onClick={() => setPage((v) => v - 1)}><ChevronLeft size={16} /> Previous</button>
          <span>Page {data?.pagination.page ?? page} of {Math.max(data?.pagination.totalPages ?? 1, 1)}</span>
          <button disabled={!data || page >= data.pagination.totalPages || loading} onClick={() => setPage((v) => v + 1)}>Next <ChevronRight size={16} /></button></div>
      </div></div>

      {canManage && valuation && <section className="valuation-panel">
        <div className="valuation-heading"><div><span className="products-eyebrow">INVENTORY ACCOUNTING CONTROL</span><h2>Opening valuation reconciliation</h2><p>Verify the physical quantity and source unit cost before recognizing opening inventory value.</p></div><strong>{valuation.summary.completionPercentage}% complete</strong></div>
        <div className="valuation-stats"><span>Tracked products <b>{valuation.summary.trackedProducts}</b></span><span>Initialized <b>{valuation.summary.initializedProducts}</b></span><span>Pending <b>{valuation.summary.pendingProducts}</b></span><span>Pending units <b>{valuation.summary.pendingStockUnits}</b></span></div>
        {valuation.items.length ? <div className="valuation-table-wrap"><table className="valuation-table"><thead><tr><th>PRODUCT</th><th>PHYSICAL STOCK</th><th>VERIFIED UNIT COST (₹)</th><th>RECONCILIATION REASON</th><th></th></tr></thead><tbody>
          {valuation.items.map(product=><tr key={product._id}><td><strong>{product.name}</strong><small>{product.sku||'No SKU'}</small></td><td>{product.stockQty} {product.unit||'pcs'}</td><td><input aria-label={'Verified unit cost for '+product.name} type="number" min="0" step=".01" value={valuationCosts[product._id]||''} onChange={e=>setValuationCosts(old=>({...old,[product._id]:e.target.value}))} placeholder="0.00"/></td><td><input aria-label={'Reconciliation reason for '+product.name} value={valuationReasons[product._id]||''} onChange={e=>setValuationReasons(old=>({...old,[product._id]:e.target.value}))} minLength={3} maxLength={250} placeholder="Physical count / supplier invoice reference"/></td><td><button disabled={valuationSaving===product._id} onClick={()=>void initializeValuation(product)}>{valuationSaving===product._id?'Saving...':'Verify & initialize'}</button></td></tr>)}
        </tbody></table></div> : <p className="valuation-clear">{valuation.summary.pendingProducts===0?'All stock-tracked products have initialized valuation.':'No pending valuation items on this page.'}</p>}
        <small className="valuation-note">This action is one-time per product and posts the opening inventory journal. Confirm the physical stock and cost evidence before submission.</small>
      </section>}

      {formOpen && <div className="products-backdrop" onClick={() => !saving && setFormOpen(false)}>
        <section className="products-form-modal" onClick={(event) => event.stopPropagation()}>
          <div className="products-modal-header"><div><span className="products-eyebrow">PRODUCT CATALOGUE</span>
            <h2>{editing ? 'Edit product' : 'Add product'}</h2><p>Enter clear product details for accurate billing and stock control.</p></div>
            <button className="products-icon-button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Close"><X size={20} /></button>
          </div>
          <form onSubmit={(event) => void saveProduct(event)}>
            <div className="products-form-section"><h3>Basic information</h3><div className="products-form-grid">
              <label className="products-field products-wide">Product name *<input required minLength={2} maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Premium Basmati Rice 5kg" /></label>
              <label className="products-field">Category<input maxLength={100} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Grocery" /></label>
              <label className="products-field">Unit<input required maxLength={30} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs, kg, litre..." /></label>
              <label className="products-field">SKU<input maxLength={60} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="Internal item code" /></label>
              <label className="products-field">Barcode<input maxLength={100} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Scan or enter barcode" /></label>
              <label className="products-field products-wide">Description<textarea rows={2} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional product description" /></label>
            </div></div>
            <div className="products-form-section"><h3>Pricing & tax</h3><div className="products-form-grid">
              <label className="products-field">Purchase price (₹) *<input required type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} /></label>
              <label className="products-field">Selling price (₹) *<input required type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} /></label>
              <label className="products-field">MRP (₹) *<input required type="number" min="0" step="0.01" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} /></label>
              <label className="products-field">GST rate<select value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })}>
                {[0, 5, 12, 18, 28].map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
              </select></label>
              <label className="products-field">HSN / SAC code<input maxLength={20} value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} /></label>
              <label className="products-check"><input type="checkbox" checked={form.priceIncludesTax} onChange={(e) => setForm({ ...form, priceIncludesTax: e.target.checked })} /> Prices include GST</label>
            </div></div>
            <div className="products-form-section"><h3>Warranty coverage</h3><div className="products-form-grid">
              <label className="products-field">Warranty duration (days)<input type="number" min="0" max="3650" step="1" value={form.warrantyDays} onChange={e => setForm({ ...form, warrantyDays: e.target.value })}/></label>
              <label className="products-field products-wide">Warranty terms<textarea rows={2} maxLength={1000} value={form.warrantyTerms} onChange={e => setForm({ ...form, warrantyTerms: e.target.value })} placeholder="Coverage, exclusions and service conditions (optional)"/></label>
              <p className="products-stock-note products-wide">Set 0 for no warranty. A warranty registration is created automatically for each eligible invoice line.</p>
            </div></div>
            <div className="products-form-section"><h3>Inventory settings</h3><div className="products-form-grid">
              {editing ? <div className="products-stock-note products-wide">Current stock: <strong>{editing.stockQty} {editing.unit}</strong>. Stock adjustments are recorded through inventory movements, not by editing the product profile.</div> :
                <label className="products-field">Opening stock<input type="number" min="0" step="1" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} /></label>}
              <label className="products-field">Low stock alert at<input type="number" min="0" step="1" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} /></label>
              <label className="products-check products-wide"><input type="checkbox" checked={form.trackStock} onChange={(e) => setForm({ ...form, trackStock: e.target.checked })} /> Track stock for this product</label>
            </div></div>
            {formError && <div className="products-error">{formError}</div>}
            <div className="products-form-footer"><button type="button" className="products-secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
              <button type="submit" className="products-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create product'}</button></div>
          </form>
        </section>
      </div>}

      {selected && <div className="products-backdrop" onClick={() => setSelected(null)}>
        <section className="products-detail-modal" onClick={(event) => event.stopPropagation()}>
          <div className="products-modal-header"><div><span className="products-eyebrow">PRODUCT PROFILE</span>
            <h2>{selected.name}</h2><p>{selected.category || 'Uncategorised'} · {selected.unit || 'pcs'}</p></div>
            <div className="products-detail-actions">{canManage && <button className="products-secondary" onClick={() => { setSelected(null); openEdit(selected); }}><Pencil size={15} /> Edit</button>}
              <button className="products-icon-button" onClick={() => setSelected(null)} aria-label="Close"><X size={20} /></button></div>
          </div>
          <div className="products-detail-grid">
            <div><small>Purchase price</small><strong>{money(selected.purchasePrice)}</strong></div>
            <div><small>Selling price</small><strong>{money(selected.sellingPrice)}</strong></div>
            <div><small>MRP</small><strong>{money(selected.mrp)}</strong></div>
            <div><small>GST rate</small><strong>{selected.gstRate}%</strong></div>
            <div><small>Available stock</small><strong>{selected.trackStock ? selected.stockQty + ' ' + (selected.unit || 'pcs') : 'Not tracked'}</strong></div>
            <div><small>Low stock threshold</small><strong>{selected.trackStock ? selected.lowStockThreshold : '—'}</strong></div>
            <div><small>SKU</small><strong>{selected.sku || '—'}</strong></div>
            <div><small>Barcode</small><strong>{selected.barcode || '—'}</strong></div>
            <div><small>HSN code</small><strong>{selected.hsnCode || '—'}</strong></div>
            <div><small>Price includes GST</small><strong>{selected.priceIncludesTax ? 'Yes' : 'No'}</strong></div>
            <div><small>Warranty</small><strong>{selected.warrantyDays ? selected.warrantyDays + ' days' : 'No warranty'}</strong></div>
          </div>
          {selected.description && <p className="products-detail-description">{selected.description}</p>}
        </section>
      </div>}
    </div>
  );
}
