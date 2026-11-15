import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Boxes, ClipboardList, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import './InventoryPage.css';

type Product = {
  _id: string; name: string; sku?: string; unit?: string;
  stockQty: number; lowStockThreshold: number; trackStock: boolean; valuationInitialized?: boolean;
};
type ProductList = { items: Product[]; pagination?: { total: number } };
type WarehouseOption = { _id: string; name: string; branchName: string };
type WarehouseStockRow = { _id: string; productId: Product | string; quantity: number; averageCost: number; inventoryValue: number };
type WarehouseReconciliation = { summary: { products: number; fullyAllocated: number; partiallyOrNotAllocated: number; discrepancies: number; totalStock: number; allocatedStock: number; unallocatedStock: number }; discrepancies: Array<{ productId: string; name: string; sku: string; issues: string[]; totalStock: number; allocatedStock: number }> };
type MovementProduct = { _id: string; name: string; sku?: string } | string;
type MovementUser = { _id: string; name?: string; email?: string } | string;
type Movement = {
  _id: string; productId: MovementProduct;
  type: 'OPENING' | 'IN' | 'OUT' | 'ADJUSTMENT' | 'SALE' | 'SALE_RETURN' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'VALUATION';
  quantityDelta: number; previousQty: number; newQty: number;
  reason: string; performedBy: MovementUser; createdAt: string;
  valuation?: { productPreviousValuePaise?: number; productValueDeltaPaise?: number; productNewValuePaise?: number; unitCostPaise?: number };
};
type MovementList = {
  items: Movement[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
};
type MovementForm = { productId: string; type: 'IN' | 'OUT' | 'ADJUSTMENT'; quantity: string; reason: string };
type ReplenishmentSuggestion = { policyId: string; product: { id: string; name: string; sku?: string; unit?: string } | null; warehouse: { id: string; name: string; code?: string } | null; onHand: number; unitsSoldInLookback: number; averageDailyDemand: number; forecastDemand: number; leadTimeDays: number; leadTimeDemand: number; reorderPoint: number; safetyStock: number; targetStock: number; needsReorder: boolean; suggestedOrderQty: number; status: 'REORDER' | 'HEALTHY' };
type ReplenishmentResult = { lookbackDays: number; forecastDays: number; summary: { policies: number; reorderRequired: number; recommendedUnits: number }; items: ReplenishmentSuggestion[]; note: string };
const blankForm: MovementForm = { productId: '', type: 'IN', quantity: '1', reason: '' };
const number = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
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
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [warehouseStock, setWarehouseStock] = useState<WarehouseStockRow[]>([]);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseReconciliation, setWarehouseReconciliation] = useState<WarehouseReconciliation | null>(null);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationForm, setAllocationForm] = useState({ productId: '', quantity: '1', reason: '' });
  const [replenishment, setReplenishment] = useState<ReplenishmentResult | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [policyForm, setPolicyForm] = useState({ productId: '', reorderPoint: '5', targetStock: '20', safetyStock: '3', leadTimeDays: '7', minimumOrderQty: '1', packSize: '1' });

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

  useEffect(() => {
    let active = true;
    async function loadWarehouses() {
      try {
        const response = await api.get<{ items: Array<{ _id: string; name: string }> }>('/branches');
        const options: WarehouseOption[] = [];
        for (const branch of response.data.items || []) {
          const detail = await api.get<{ warehouses?: Array<{ _id: string; name: string; isActive: boolean }> }>('/branches/' + branch._id);
          for (const warehouse of detail.data.warehouses || []) if (warehouse.isActive) {
            options.push({ _id: warehouse._id, name: warehouse.name, branchName: branch.name });
          }
        }
        if (active) {
          setWarehouseOptions(options);
          if (options.length) setSelectedWarehouse(current => current || options[0]._id);
        }
      } catch { if (active) setWarehouseOptions([]); }
    }
    void loadWarehouses();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (canManage) {
      api.get<WarehouseReconciliation>('/inventory/warehouse-reconciliation')
        .then(response => { if (active) setWarehouseReconciliation(response.data); })
        .catch(() => { if (active) setWarehouseReconciliation(null); });
    }
    return () => { active = false; };
  }, [canManage]);

  useEffect(() => {
    let active = true;
    if (!selectedWarehouse) { setWarehouseStock([]); return; }
    setWarehouseLoading(true);
    api.get<{ items: WarehouseStockRow[] }>('/inventory/warehouses/' + selectedWarehouse + '/stock')
      .then(response => { if (active) setWarehouseStock(response.data.items || []); })
      .catch(() => { if (active) setError('Warehouse stock could not be loaded.'); })
      .finally(() => { if (active) setWarehouseLoading(false); });
    return () => { active = false; };
  }, [selectedWarehouse]);

  useEffect(() => {
    let active = true;
    if (!selectedWarehouse) { setReplenishment(null); return; }
    api.get<ReplenishmentResult>('/inventory/replenishment/suggestions', { params: { warehouseId: selectedWarehouse, lookbackDays: 90, forecastDays: 30 } })
      .then(response => { if (active) setReplenishment(response.data); })
      .catch(() => { if (active) setReplenishment(null); });
    return () => { active = false; };
  }, [selectedWarehouse]);

  async function saveReplenishmentPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWarehouse) return;
    setPolicySaving(true); setPolicyError('');
    try {
      await api.post('/inventory/replenishment/policies', {
        ...policyForm, warehouseId: selectedWarehouse,
        reorderPoint: Number(policyForm.reorderPoint), targetStock: Number(policyForm.targetStock),
        safetyStock: Number(policyForm.safetyStock), leadTimeDays: Number(policyForm.leadTimeDays),
        minimumOrderQty: Number(policyForm.minimumOrderQty), packSize: Number(policyForm.packSize),
      });
      setPolicyOpen(false);
      const response = await api.get<ReplenishmentResult>('/inventory/replenishment/suggestions', { params: { warehouseId: selectedWarehouse, lookbackDays: 90, forecastDays: 30 } });
      setReplenishment(response.data);
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setPolicyError(Array.isArray(message) ? message.join(', ') : message || 'Replenishment policy could not be saved.');
    } finally { setPolicySaving(false); }
  }

  async function saveOpeningAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWarehouse) return;
    const quantity = Number(allocationForm.quantity);
    if (!Number.isInteger(quantity) || quantity < 0 || !allocationForm.reason.trim()) {
      setFormError('Enter a whole-number quantity and a reason.');
      return;
    }
    setSaving(true); setFormError('');
    try {
      await api.post('/inventory/warehouses/' + selectedWarehouse + '/stock/opening', {
        productId: allocationForm.productId, quantity, reason: allocationForm.reason.trim(),
      });
      setAllocationOpen(false); setAllocationForm({ productId: '', quantity: '1', reason: '' });
      const response = await api.get<{ items: WarehouseStockRow[] }>('/inventory/warehouses/' + selectedWarehouse + '/stock');
      setWarehouseStock(response.data.items || []);
      await loadInventory();
    } catch (requestError: unknown) {
      const message = (requestError as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setFormError(Array.isArray(message) ? message.join(', ') : message || 'Opening allocation could not be saved.');
    } finally { setSaving(false); }
  }



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
            <th>PRODUCT</th><th>MOVEMENT</th><th>CHANGE</th><th>PREVIOUS</th><th>NEW STOCK</th><th>VALUE CHANGE</th><th>REASON</th><th>RECORDED BY</th><th>DATE & TIME</th>
          </tr></thead><tbody>
            {loading ? <tr><td colSpan={9} className="inventory-empty">Loading stock ledger...</td></tr> :
              !movements?.items.length ? <tr><td colSpan={9} className="inventory-empty">
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
                  <td title={movement.valuation?.productPreviousValuePaise !== undefined && movement.valuation?.productNewValuePaise !== undefined ? `Inventory value: ${money(movement.valuation.productPreviousValuePaise / 100)} → ${money(movement.valuation.productNewValuePaise / 100)}` : 'Historical valuation snapshot unavailable'}>
                    {movement.valuation?.productValueDeltaPaise !== undefined
                      ? <strong className={movement.valuation.productValueDeltaPaise >= 0 ? 'inventory-positive' : 'inventory-negative'}>{movement.valuation.productValueDeltaPaise > 0 ? '+' : ''}{money(movement.valuation.productValueDeltaPaise / 100)}</strong>
                      : <span className="inventory-date">—</span>}
                  </td>
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

      {canManage && warehouseReconciliation && <section className="inventory-panel inventory-reconciliation-panel">
        <div className="inventory-panel-heading"><div><h2>Warehouse allocation reconciliation</h2><p>Compares warehouse allocations with business-wide stock and inventory valuation.</p></div><span className={warehouseReconciliation.summary.discrepancies?'inventory-recon-alert':'inventory-recon-ok'}>{warehouseReconciliation.summary.discrepancies} discrepancies</span></div>
        <div className="inventory-recon-stats"><span>Total stock <b>{number(warehouseReconciliation.summary.totalStock)}</b></span><span>Allocated <b>{number(warehouseReconciliation.summary.allocatedStock)}</b></span><span>Unallocated pool <b>{number(warehouseReconciliation.summary.unallocatedStock)}</b></span><span>Fully allocated products <b>{number(warehouseReconciliation.summary.fullyAllocated)}</b></span></div>
        {warehouseReconciliation.discrepancies.length>0?<div className="inventory-recon-list">{warehouseReconciliation.discrepancies.slice(0,10).map(item=><div key={item.productId}><strong>{item.name}</strong><small>{item.sku||'No SKU'} · {item.issues.join(', ')}</small><b>{number(item.allocatedStock)} / {number(item.totalStock)}</b></div>)}</div>:<p className="inventory-recon-clear">No over-allocation discrepancies detected. Unallocated stock remains available for future warehouse assignment.</p>}
      </section>}

      {warehouseOptions.length > 0 && <section className="inventory-panel inventory-warehouse-panel">
        <div className="inventory-panel-heading"><div><h2>Warehouse stock & allocation</h2><p>View physical stock by warehouse. Opening allocations move existing aggregate stock into a location without changing total stock.</p></div>
          <label className="inventory-filter"><span>Warehouse</span><select value={selectedWarehouse} onChange={e=>setSelectedWarehouse(e.target.value)}>{warehouseOptions.map(w=><option key={w._id} value={w._id}>{w.branchName} · {w.name}</option>)}</select></label>
          {canManage && <button className="inventory-primary" onClick={()=>{setFormError('');setAllocationForm({productId:trackedProducts.find(p=>p.valuationInitialized)?._id||'',quantity:'1',reason:''});setAllocationOpen(true);}}><Boxes size={15}/> Allocate opening stock</button>}
        </div>
        <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>PRODUCT</th><th>WAREHOUSE QTY</th><th>AVERAGE COST</th><th>INVENTORY VALUE</th></tr></thead><tbody>
          {warehouseLoading?<tr><td colSpan={4} className="inventory-empty">Loading warehouse stock...</td></tr>:warehouseStock.length?warehouseStock.map(row=>{const p=typeof row.productId==='string'?null:row.productId;return <tr key={row._id}><td><strong>{p?.name||'Product'}</strong>{p?.sku&&<small>{p.sku}</small>}</td><td>{number(row.quantity)}</td><td>{money(row.averageCost)}</td><td>{money(row.inventoryValue)}</td></tr>;}):<tr><td colSpan={4} className="inventory-empty">No stock allocations in this warehouse yet.</td></tr>}
        </tbody></table></div>
      </section>}

      {warehouseOptions.length > 0 && <section className="inventory-panel inventory-replenishment-panel">
        <div className="inventory-panel-heading">
          <div><h2>Smart replenishment & demand forecast</h2><p>Warehouse-specific reorder recommendations based on the last 90 days of issued sales.</p></div>
          {canManage && <button className="inventory-primary" onClick={() => { setPolicyError(''); setPolicyForm({ productId: trackedProducts[0]?._id || '', reorderPoint: '5', targetStock: '20', safetyStock: '3', leadTimeDays: '7', minimumOrderQty: '1', packSize: '1' }); setPolicyOpen(true); }} disabled={!trackedProducts.length}>Configure reorder policy</button>}
        </div>
        {replenishment ? <>
          <div className="inventory-replenishment-metrics">
            <span>Configured products <b>{number(replenishment.summary.policies)}</b></span>
            <span>Reorder required <b>{number(replenishment.summary.reorderRequired)}</b></span>
            <span>Suggested units <b>{number(replenishment.summary.recommendedUnits)}</b></span>
          </div>
          <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>PRODUCT</th><th>ON HAND</th><th>AVG. DAILY DEMAND</th><th>30-DAY FORECAST</th><th>LEAD-TIME DEMAND</th><th>REORDER POINT</th><th>SUGGESTED QTY</th><th>STATUS</th></tr></thead><tbody>
            {replenishment.items.length ? replenishment.items.map(item => <tr key={item.policyId}><td><strong>{item.product?.name || 'Product'}</strong><small>{item.warehouse?.name || 'Warehouse'} · {item.product?.sku || 'No SKU'}</small></td><td>{number(item.onHand)} {item.product?.unit || 'pcs'}</td><td>{number(item.averageDailyDemand)}</td><td>{number(item.forecastDemand)}</td><td>{number(item.leadTimeDemand)}</td><td>{number(item.reorderPoint)}</td><td><strong>{number(item.suggestedOrderQty)} {item.product?.unit || 'pcs'}</strong></td><td><span className={item.needsReorder ? 'inventory-replenishment-status is-reorder' : 'inventory-replenishment-status'}>{item.needsReorder ? 'REORDER' : 'HEALTHY'}</span></td></tr>) : <tr><td colSpan={8} className="inventory-empty">No replenishment policies configured for this warehouse.</td></tr>}
          </tbody></table></div>
          <p className="inventory-replenishment-note">{replenishment.note}</p>
        </> : <div className="inventory-all-clear">Demand forecast is not available yet. Configure a replenishment policy to start tracking reorder recommendations.</div>}
      </section>}

      {policyOpen && <div className="inventory-backdrop" onClick={() => !policySaving && setPolicyOpen(false)}><form className="inventory-modal" onSubmit={saveReplenishmentPolicy} onClick={e => e.stopPropagation()}>
        <div className="inventory-modal-heading"><div><span className="inventory-eyebrow">DEMAND-BASED STOCK PLANNING</span><h2>Configure replenishment policy</h2><p>Set warehouse-level thresholds and supplier lead-time buffers.</p></div><button type="button" className="inventory-close" onClick={() => setPolicyOpen(false)}><X size={18}/></button></div>
        <label className="inventory-field">Product *<select required value={policyForm.productId} onChange={e => setPolicyForm({ ...policyForm, productId: e.target.value })}><option value="">Select stock-tracked product</option>{trackedProducts.map(p => <option key={p._id} value={p._id}>{p.name} · {p.sku || 'No SKU'}</option>)}</select></label>
        <div className="inventory-policy-grid">
          <label className="inventory-field">Reorder point *<input required type="number" min="0" step="0.01" value={policyForm.reorderPoint} onChange={e => setPolicyForm({ ...policyForm, reorderPoint: e.target.value })}/></label>
          <label className="inventory-field">Target stock *<input required type="number" min="1" step="0.01" value={policyForm.targetStock} onChange={e => setPolicyForm({ ...policyForm, targetStock: e.target.value })}/></label>
          <label className="inventory-field">Safety stock *<input required type="number" min="0" step="0.01" value={policyForm.safetyStock} onChange={e => setPolicyForm({ ...policyForm, safetyStock: e.target.value })}/></label>
          <label className="inventory-field">Supplier lead time (days) *<input required type="number" min="0" max="365" step="1" value={policyForm.leadTimeDays} onChange={e => setPolicyForm({ ...policyForm, leadTimeDays: e.target.value })}/></label>
          <label className="inventory-field">Minimum order qty *<input required type="number" min="1" step="1" value={policyForm.minimumOrderQty} onChange={e => setPolicyForm({ ...policyForm, minimumOrderQty: e.target.value })}/></label>
          <label className="inventory-field">Supplier pack size *<input required type="number" min="1" step="1" value={policyForm.packSize} onChange={e => setPolicyForm({ ...policyForm, packSize: e.target.value })}/></label>
        </div>
        {policyError && <div className="inventory-error">{policyError}</div>}
        <div className="inventory-modal-actions"><button type="button" className="inventory-secondary" onClick={() => setPolicyOpen(false)} disabled={policySaving}>Cancel</button><button type="submit" className="inventory-primary" disabled={policySaving || !policyForm.productId}>{policySaving ? 'Saving...' : 'Save replenishment policy'}</button></div>
      </form></div>}

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

      {allocationOpen && <div className="inventory-backdrop" onClick={()=>!saving&&setAllocationOpen(false)}><form className="inventory-modal" onSubmit={saveOpeningAllocation} onClick={e=>e.stopPropagation()}>
        <div className="inventory-modal-heading"><div><span className="inventory-eyebrow">WAREHOUSE OPENING ALLOCATION</span><h2>Allocate existing stock</h2><p>Does not increase business-wide stock. Use only after confirming location count.</p></div><button type="button" className="inventory-close" onClick={()=>setAllocationOpen(false)}><X size={18}/></button></div>
        <label className="inventory-field">Product *<select required value={allocationForm.productId} onChange={e=>setAllocationForm({...allocationForm,productId:e.target.value})}><option value="">Select verified product</option>{trackedProducts.filter(p=>p.valuationInitialized).map(p=><option key={p._id} value={p._id}>{p.name} · total {number(p.stockQty)}</option>)}</select></label>
        <label className="inventory-field">Quantity to allocate *<input required type="number" min="0" step="1" value={allocationForm.quantity} onChange={e=>setAllocationForm({...allocationForm,quantity:e.target.value})}/></label>
        <label className="inventory-field">Reason / physical count reference *<textarea required minLength={3} maxLength={250} rows={3} value={allocationForm.reason} onChange={e=>setAllocationForm({...allocationForm,reason:e.target.value})}/></label>
        {formError&&<div className="inventory-error">{formError}</div>}<div className="inventory-modal-actions"><button type="button" className="inventory-secondary" onClick={()=>setAllocationOpen(false)}>Cancel</button><button className="inventory-primary" disabled={saving||!allocationForm.productId}>{saving?'Allocating...':'Confirm allocation'}</button></div>
      </form></div>}
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
