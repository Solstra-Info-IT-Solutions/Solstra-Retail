import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Boxes, ClipboardList, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import './InventoryPage.css';

type Product = {
  _id: string; name: string; sku?: string; unit?: string;
  stockQty: number; lowStockThreshold: number; trackStock: boolean;
};
type ProductList = { items: Product[]; pagination?: { total: number } };
type MovementProduct = { _id: string; name: string; sku?: string } | string;
type MovementUser = { _id: string; name?: string; email?: string } | string;
type Movement = {
  _id: string; productId: MovementProduct;
  type: 'OPENING' | 'IN' | 'OUT' | 'ADJUSTMENT' | 'SALE' | 'SALE_RETURN';
  quantityDelta: number; previousQty: number; newQty: number;
  reason: string; performedBy: MovementUser; createdAt: string;
};
type MovementList = {
  items: Movement[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
};
type MovementForm = { productId: string; type: 'IN' | 'OUT' | 'ADJUSTMENT'; quantity: string; reason: string };
const blankForm: MovementForm = { productId: '', type: 'IN', quantity: '1', reason: '' };
const number = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
const productName = (value: MovementProduct) => typeof value === 'string' ? 'Product' : value?.name || 'Product';
const userName = (value: MovementUser) => typeof value === 'string' ? 'User' : value?.name || value?.email || 'User';
const dateTime = (value: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function InventoryPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const [products, setProducts] = useState<Product[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [movements, setMovements] = useState<MovementList | null>(null);
  const [productFilter, setProductFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<MovementForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [productResponse, lowResponse, movementResponse] = await Promise.all([
        api.get<ProductList>('/products', { params: { page: 1, limit: 100 } }),
        api.get<{ items: Product[]; total: number }>('/products/low-stock'),
        api.get<MovementList>('/inventory/movements', {
          params: { page, limit: 20, ...(productFilter ? { productId: productFilter } : {}) },
        }),
      ]);
      setProducts(productResponse.data.items || []);
      setLowStock(lowResponse.data.items || []);
      setMovements(movementResponse.data);
    } catch {
      setError('Inventory data could not be loaded. Refresh the page and try again.');
    } finally {
      setLoading(false);
    }
  }, [page, productFilter]);

  useEffect(() => { void loadInventory(); }, [loadInventory]);

  const trackedProducts = useMemo(() => products.filter((item) => item.trackStock), [products]);
  const totalUnits = trackedProducts.reduce((sum, item) => sum + (Number(item.stockQty) || 0), 0);
  const selectedProduct = trackedProducts.find((item) => item._id === form.productId);

  function openMovement() {
    setForm({ ...blankForm, productId: trackedProducts[0]?._id || '' });
    setFormError('');
    setModalOpen(true);
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < 0 || (form.type !== 'ADJUSTMENT' && quantity < 1)) {
      setFormError(form.type === 'ADJUSTMENT' ? 'Enter a whole-number target stock quantity.' : 'Enter a whole-number quantity of at least 1.');
      setSaving(false);
      return;
    }
    try {
      await api.post('/inventory/products/' + form.productId + '/movements', {
        type: form.type, quantity, reason: form.reason.trim(),
      });
      setModalOpen(false);
      setForm(blankForm);
      await loadInventory();
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setFormError(Array.isArray(message) ? message.join(', ') : message || 'Stock movement could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const totalMovements = movements?.pagination.total ?? 0;

  return (
    <div className="inventory-page">
      <div className="inventory-heading">
        <div><span className="inventory-eyebrow">STOCK CONTROL & AUDIT TRAIL</span>
          <h1>Inventory</h1><p>Track stock in, stock out, adjustments and every recorded movement.</p></div>
        <div className="inventory-heading-actions">
          <button className="inventory-secondary" onClick={() => void loadInventory()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'inventory-spin' : ''} /> Refresh
          </button>
          {canManage && <button className="inventory-primary" onClick={openMovement} disabled={trackedProducts.length === 0}>
            <SlidersHorizontal size={16} /> Record movement
          </button>}
        </div>
      </div>

      <div className="inventory-metrics">
        <div className="inventory-metric"><span className="inventory-metric-icon"><ClipboardList size={18} /></span>
          <div><small>Stock-tracked products</small><strong>{loading && !products.length ? '—' : number(trackedProducts.length)}</strong></div></div>
        <div className="inventory-metric"><span className="inventory-metric-icon"><Boxes size={18} /></span>
          <div><small>Total units in stock</small><strong>{loading && !products.length ? '—' : number(totalUnits)}</strong></div></div>
        <div className="inventory-metric"><span className="inventory-metric-icon is-warning"><AlertTriangle size={18} /></span>
          <div><small>Low stock products</small><strong>{loading && !lowStock.length ? '—' : number(lowStock.length)}</strong></div></div>
      </div>

      {error && <div className="inventory-error">{error}</div>}

      <section className="inventory-panel">
        <div className="inventory-panel-heading">
          <div><h2>Stock movement ledger</h2><p>Latest stock changes across your catalogue, with before-and-after quantities.</p></div>
          <label className="inventory-filter"> <span>Product</span>
            <select value={productFilter} onChange={(event) => { setProductFilter(event.target.value); setPage(1); }}>
              <option value="">All products</option>
              {products.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}
            </select>
          </label>
        </div>
        <div className="inventory-table-wrap">
          <table className="inventory-table"><thead><tr>
            <th>PRODUCT</th><th>MOVEMENT</th><th>CHANGE</th><th>PREVIOUS</th><th>NEW STOCK</th><th>REASON</th><th>RECORDED BY</th><th>DATE & TIME</th>
          </tr></thead><tbody>
            {loading ? <tr><td colSpan={8} className="inventory-empty">Loading stock ledger...</td></tr> :
              !movements?.items.length ? <tr><td colSpan={8} className="inventory-empty">
                <ClipboardList size={30} /><strong>No stock movements found</strong>
                <span>New stock receipts, issues and adjustments will appear here.</span>
              </td></tr> : movements.items.map((movement) => (
                <tr key={movement._id}>
                  <td><strong>{productName(movement.productId)}</strong>
                    {typeof movement.productId !== 'string' && movement.productId.sku && <small>{movement.productId.sku}</small>}</td>
                  <td><span className={'inventory-type type-' + movement.type.toLowerCase()}>{movement.type.replace('_', ' ')}</span></td>
                  <td><strong className={movement.quantityDelta >= 0 ? 'inventory-positive' : 'inventory-negative'}>
                    {movement.quantityDelta > 0 ? '+' : ''}{number(movement.quantityDelta)}</strong></td>
                  <td>{number(movement.previousQty)}</td><td><strong>{number(movement.newQty)}</strong></td>
                  <td className="inventory-reason">{movement.reason}</td><td>{userName(movement.performedBy)}</td>
                  <td className="inventory-date">{dateTime(movement.createdAt)}</td>
                </tr>
              ))}
          </tbody></table>
        </div>
        <div className="inventory-pagination"><span>{totalMovements ? 'Showing ' + ((page - 1) * 20 + 1) + '–' + Math.min(page * 20, totalMovements) + ' of ' + totalMovements : 'No records'}</span>
          <div><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <span>Page {movements?.pagination.page ?? page} of {Math.max(movements?.pagination.totalPages ?? 1, 1)}</span>
            <button disabled={!movements || page >= movements.pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div>
        </div>
      </section>

      <section className="inventory-panel inventory-low-panel">
        <div className="inventory-panel-heading"><div><h2>Low stock watchlist</h2>
          <p>Products at or below their configured reorder threshold.</p></div><span className="inventory-watch-count">{lowStock.length} items</span></div>
        {lowStock.length ? <div className="inventory-low-grid">{lowStock.slice(0, 8).map((product) => (
          <div className="inventory-low-item" key={product._id}>
            <span className="inventory-low-icon"><AlertTriangle size={16} /></span>
            <div><strong>{product.name}</strong><small>{product.sku || 'No SKU'} · Alert at {number(product.lowStockThreshold)} {product.unit || 'pcs'}</small></div>
            <b>{number(product.stockQty)} <small>{product.unit || 'pcs'}</small></b>
          </div>
        ))}</div> : <div className="inventory-all-clear">No low-stock products detected in the current watchlist.</div>}
      </section>

      {modalOpen && <div className="inventory-backdrop" onClick={() => !saving && setModalOpen(false)}>
        <section className="inventory-modal" onClick={(event) => event.stopPropagation()}>
          <div className="inventory-modal-heading"><div><span className="inventory-eyebrow">AUDITED STOCK CHANGE</span>
            <h2>Record stock movement</h2><p>Every change is saved to the stock ledger.</p></div>
            <button className="inventory-close" onClick={() => setModalOpen(false)} disabled={saving} aria-label="Close"><X size={19} /></button>
          </div>
          <form onSubmit={(event) => void submitMovement(event)}>
            <label className="inventory-field">Product *
              <select required value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
                {trackedProducts.map((product) => <option key={product._id} value={product._id}>{product.name} — {number(product.stockQty)} {product.unit || 'pcs'} available</option>)}
              </select>
            </label>
            {selectedProduct && <div className="inventory-current-stock">Current stock <strong>{number(selectedProduct.stockQty)} {selectedProduct.unit || 'pcs'}</strong></div>}
            <label className="inventory-field">Movement type *
              <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MovementForm['type'] })}>
                <option value="IN">Stock in — receive or add units</option>
                <option value="OUT">Stock out — issue or remove units</option>
                <option value="ADJUSTMENT">Set exact stock quantity</option>
              </select>
            </label>
            <label className="inventory-field">{form.type === 'ADJUSTMENT' ? 'New total stock quantity *' : 'Quantity *'}
              <input required type="number" min={form.type === 'ADJUSTMENT' ? 0 : 1} step="1" value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
              <small>{form.type === 'ADJUSTMENT' ? 'Enter the final physical count after stock verification.' : 'Enter the number of units ' + (form.type === 'IN' ? 'received.' : 'removed.')}</small>
            </label>
            <label className="inventory-field">Reason / reference *
              <textarea required minLength={3} maxLength={250} rows={3} value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="e.g. Supplier delivery INV-104 or damaged goods" />
            </label>
            {formError && <div className="inventory-error">{formError}</div>}
            <div className="inventory-modal-actions"><button type="button" className="inventory-secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button>
              <button type="submit" className="inventory-primary" disabled={saving || !form.productId}>{saving ? 'Saving movement...' : 'Save movement'}</button></div>
          </form>
        </section>
      </div>}
    </div>
  );
}
