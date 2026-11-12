import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, Eye, X, Printer, ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react';
import { api } from '../api/client';
import './SalesPage.css';

type Invoice = {
  _id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerPhone: string;
  items: {
    name: string;
    sku?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    discountAmount: number;
    taxableValue: number;
    gstRate: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalTax: number;
    lineTotal: number;
  }[];
  subtotal: number;
  discountTotal: number;
  taxableValue: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  totalTax: number;
  grandTotal: number;
  creditedAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'CREDITED';
  payments: {
    method: string;
    amount: number;
    reference?: string;
    paidAt: string;
  }[];
  status: 'ISSUED' | 'CANCELLED';
  sellerName: string;
  sellerGstin?: string | null;
  sellerAddress?: string;
  sellerStateCode: string;
  customerGstin?: string | null;
  placeOfSupplyStateCode: string;
};

type SalesResponse = {
  items: Invoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const money = (value = 0) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const date = (value: string) =>
  value
    ? new Date(value).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const paymentLabel: Record<string, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  CREDITED: 'Credited',
};

export default function SalesPage() {
  const [data, setData] = useState<SalesResponse | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<SalesResponse>('/sales', {
        params: { page, limit: 20, ...(search.trim() ? { search: search.trim() } : {}) },
      });
      setData(response.data);
    } catch {
      setError('Sales records could not be loaded. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSales(), 300);
    return () => window.clearTimeout(timer);
  }, [loadSales]);

  async function openInvoice(invoice: Invoice) {
    setSelected(invoice);
    setDetailLoading(true);
    try {
      const response = await api.get<Invoice>(`/sales/${invoice._id}`);
      setSelected(response.data);
    } catch {
      setSelected(invoice);
    } finally {
      setDetailLoading(false);
    }
  }

  function printInvoice() {
    window.print();
  }

  const invoices = data?.items ?? [];

  return (
    <div className="sales-page">
      <div className="sales-heading">
        <div>
          <span className="sales-eyebrow">BILLING & COLLECTIONS</span>
          <h1>Sales Register</h1>
          <p>View invoices, track collections and check outstanding balances.</p>
        </div>
        <button className="sales-refresh" onClick={() => void loadSales()} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'sales-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="sales-toolbar">
        <div className="sales-search">
          <Search size={18} />
          <input
            value={search}
            placeholder="Search invoice number, customer or phone..."
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch('')}>
              <X size={16} />
            </button>
          )}
        </div>
        <span className="sales-record-count">
          {data ? `${data.total} invoice${data.total === 1 ? '' : 's'}` : 'Loading records'}
        </span>
      </div>

      {error && <div className="sales-error">{error}</div>}

      <div className="sales-table-card">
        <div className="sales-table-wrap">
          <table className="sales-table">
            <thead>
              <tr>
                <th>INVOICE</th>
                <th>DATE</th>
                <th>CUSTOMER</th>
                <th className="sales-number">TOTAL</th>
                <th className="sales-number">PAID</th>
                <th className="sales-number">DUE</th>
                <th>PAYMENT</th>
                <th>STATUS</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="sales-empty">Loading sales records...</td></tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="sales-empty">
                    <ReceiptText size={30} />
                    <strong>No invoices found</strong>
                    <span>{search ? 'Try another search term.' : 'Invoices created through POS will appear here.'}</span>
                  </td>
                </tr>
              ) : invoices.map((invoice) => (
                <tr key={invoice._id}>
                  <td className="sales-invoice-number">{invoice.invoiceNumber}</td>
                  <td>{date(invoice.invoiceDate)}</td>
                  <td>
                    <strong>{invoice.customerName || 'Walk-in Customer'}</strong>
                    {invoice.customerPhone && <small>{invoice.customerPhone}</small>}
                  </td>
                  <td className="sales-number sales-amount">{money(invoice.grandTotal)}</td>
                  <td className="sales-number">{money(invoice.paidAmount)}</td>
                  <td className="sales-number sales-due">{money(invoice.dueAmount)}</td>
                  <td>
                    <span className={`sales-payment payment-${invoice.paymentStatus.toLowerCase()}`}>
                      {paymentLabel[invoice.paymentStatus] || invoice.paymentStatus}
                    </span>
                  </td>
                  <td>
                    <span className={`sales-status ${invoice.status === 'CANCELLED' ? 'status-cancelled' : 'status-issued'}`}>
                      {invoice.status === 'CANCELLED' ? 'Cancelled' : 'Issued'}
                    </span>
                  </td>
                  <td>
                    <button className="sales-view-button" onClick={() => void openInvoice(invoice)} title="View invoice">
                      <Eye size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sales-pagination">
          <span>
            {data && data.total > 0
              ? `Showing ${(page - 1) * 20 + 1}–${Math.min(page * 20, data.total)} of ${data.total}`
              : 'No records'}
          </span>
          <div>
            <button disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>
              <ChevronLeft size={17} /> Previous
            </button>
            <span>Page {data?.page ?? page} of {Math.max(data?.totalPages ?? 1, 1)}</span>
            <button disabled={!data || page >= data.totalPages || loading} onClick={() => setPage((current) => current + 1)}>
              Next <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="sales-modal-backdrop" onClick={() => setSelected(null)}>
          <section className="sales-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="sales-detail-header">
              <div>
                <span className="sales-eyebrow">INVOICE DETAILS</span>
                <h2>{selected.invoiceNumber}</h2>
                <span>{date(selected.invoiceDate)}</span>
              </div>
              <div className="sales-detail-actions">
                <button onClick={printInvoice} title="Print invoice"><Printer size={18} /> Print</button>
                <button className="sales-close" onClick={() => setSelected(null)} aria-label="Close"><X size={20} /></button>
              </div>
            </div>

            {detailLoading && <p className="sales-detail-loading">Loading invoice details...</p>}

            <div className="sales-parties">
              <div><span>FROM</span><strong>{selected.sellerName}</strong><small>{selected.sellerAddress || '—'}</small>{selected.sellerGstin && <small>GSTIN: {selected.sellerGstin}</small>}</div>
              <div><span>BILL TO</span><strong>{selected.customerName || 'Walk-in Customer'}</strong><small>{selected.customerPhone || '—'}</small>{selected.customerGstin && <small>GSTIN: {selected.customerGstin}</small>}</div>
            </div>

            <div className="sales-detail-table-wrap">
              <table className="sales-detail-table">
                <thead><tr><th>ITEM</th><th>QTY</th><th>RATE</th><th>GST</th><th>AMOUNT</th></tr></thead>
                <tbody>
                  {selected.items?.map((item, index) => (
                    <tr key={`${item.sku || item.name}-${index}`}>
                      <td><strong>{item.name}</strong>{item.sku && <small>{item.sku}</small>}</td>
                      <td>{item.quantity} {item.unit}</td>
                      <td>{money(item.unitPrice)}</td>
                      <td>{item.gstRate}%</td>
                      <td>{money(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sales-detail-bottom">
              <div className="sales-payment-history">
                <h3>Payment history</h3>
                {selected.payments?.length ? selected.payments.map((payment, index) => (
                  <div key={`${payment.paidAt}-${index}`}>
                    <span>{payment.method} · {date(payment.paidAt)}</span><strong>{money(payment.amount)}</strong>
                  </div>
                )) : <p>No payments recorded.</p>}
              </div>
              <div className="sales-totals">
                <div><span>Subtotal</span><strong>{money(selected.subtotal)}</strong></div>
                <div><span>Discount</span><strong>{money(selected.discountTotal)}</strong></div>
                <div><span>Taxable value</span><strong>{money(selected.taxableValue)}</strong></div>
                {selected.cgstTotal > 0 && <div><span>CGST</span><strong>{money(selected.cgstTotal)}</strong></div>}
                {selected.sgstTotal > 0 && <div><span>SGST</span><strong>{money(selected.sgstTotal)}</strong></div>}
                {selected.igstTotal > 0 && <div><span>IGST</span><strong>{money(selected.igstTotal)}</strong></div>}
                <div><span>Total tax</span><strong>{money(selected.totalTax)}</strong></div>
                <div className="sales-grand-total"><span>Grand total</span><strong>{money(selected.grandTotal)}</strong></div>
                <div><span>Paid</span><strong>{money(selected.paidAmount)}</strong></div>
                <div className="sales-balance"><span>Balance due</span><strong>{money(selected.dueAmount)}</strong></div>
              </div>
            </div>
            <div className="sales-detail-footer">
              <span>Place of supply: {selected.placeOfSupplyStateCode}</span>
              <span className={selected.status === 'CANCELLED' ? 'status-cancelled' : 'status-issued'}>{selected.status}</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

