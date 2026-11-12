import { useCallback, useEffect, useState } from 'react';
import {
  Activity, IndianRupee, ReceiptText, Wallet,
  Package, Boxes, AlertTriangle, RefreshCw,
  ShoppingCart, Users, ArrowUpRight
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import './DashboardPage.css';

interface DashboardSummary {
  generatedAt: string;
  currency: 'INR';
  amountUnit: 'RUPEES';
  today: {
    invoiceCount: number;
    grossSalesRupees: number;
    creditNotesRupees: number;
    netSalesRupees: number;
    collectionsRupees: number;
    refundsRupees: number;
  };
  month: {
    invoiceCount: number;
    grossSalesRupees: number;
    creditNotesRupees: number;
    netSalesRupees: number;
  };
  outstandingDuesRupees: number;
  lowStockProductCount: number;
  inventory: {
    productCount: number;
    totalUnits: number;
    valuationAtPurchaseCostRupees: number;
  };
}

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value || 0);

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await api.get<DashboardSummary>('/dashboard/summary');
      setData(response.data);
    } catch {
      setError('Unable to load dashboard data. Please check your API connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const stats = data ? [
    {
      label: "Today's Gross Sales",
      value: money(data.today.grossSalesRupees),
      detail: `${data.today.invoiceCount} invoices today`,
      icon: IndianRupee,
      tone: 'apricot',
    },
    {
      label: 'Monthly Net Sales',
      value: money(data.month.netSalesRupees),
      detail: `${data.month.invoiceCount} invoices this month`,
      icon: ReceiptText,
      tone: 'green',
    },
    {
      label: 'Outstanding Dues',
      value: money(data.outstandingDuesRupees),
      detail: 'Pending customer payments',
      icon: Wallet,
      tone: 'orange',
    },
    {
      label: 'Low Stock Products',
      value: String(data.lowStockProductCount),
      detail: 'Products at or below threshold',
      icon: AlertTriangle,
      tone: 'red',
    },
  ] : [];

  return (
    <div className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">OVERVIEW</span>
          <h1>Dashboard</h1>
          <p>Welcome back. Here's your business summary.</p>
        </div>
        <button className="refresh-dashboard" onClick={() => void loadDashboard()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'refresh-spinning' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="dashboard-error">
          <span>{error}</span>
          <button onClick={() => void loadDashboard()}>Retry</button>
        </div>
      )}

      {loading && !data ? (
        <div className="dashboard-loading">
          <div className="loading-spinner" />
          <span>Loading your business summary...</span>
        </div>
      ) : data ? (
        <>
          <div className="dashboard-stats-grid">
            {stats.map(({ label, value, detail, icon: Icon, tone }) => (
              <article className="dashboard-stat-card" key={label}>
                <div className="stat-card-top">
                  <span>{label}</span>
                  <div className={`stat-icon ${tone}`}><Icon size={19} /></div>
                </div>
                <strong className="stat-value">{value}</strong>
                <span className="stat-detail">{detail}</span>
              </article>
            ))}
          </div>

          <div className="dashboard-main-grid">
            <section className="dashboard-panel sales-panel">
              <div className="panel-heading">
                <div>
                  <h2>Sales Overview</h2>
                  <p>Today's business performance</p>
                </div>
                <Activity size={20} />
              </div>
              <div className="sales-highlight">
                <span>Today's Net Sales</span>
                <strong>{money(data.today.netSalesRupees)}</strong>
              </div>
              <div className="sales-breakdown">
                <div>
                  <span>Gross Sales</span>
                  <strong>{money(data.today.grossSalesRupees)}</strong>
                </div>
                <div>
                  <span>Collections</span>
                  <strong>{money(data.today.collectionsRupees)}</strong>
                </div>
                <div>
                  <span>Credit Notes</span>
                  <strong>{money(data.today.creditNotesRupees)}</strong>
                </div>
                <div>
                  <span>Refunds</span>
                  <strong>{money(data.today.refundsRupees)}</strong>
                </div>
              </div>
            </section>

            <section className="dashboard-panel inventory-panel">
              <div className="panel-heading">
                <div>
                  <h2>Inventory Summary</h2>
                  <p>Your current stock position</p>
                </div>
                <Package size={20} />
              </div>
              <div className="inventory-total">
                <strong>{data.inventory.productCount.toLocaleString('en-IN')}</strong>
                <span>Tracked products</span>
              </div>
              <div className="inventory-metrics">
                <div>
                  <Boxes size={17} />
                  <span>Total stock units</span>
                  <strong>{data.inventory.totalUnits.toLocaleString('en-IN')}</strong>
                </div>
                <div>
                  <IndianRupee size={17} />
                  <span>Purchase valuation</span>
                  <strong>{money(data.inventory.valuationAtPurchaseCostRupees)}</strong>
                </div>
                <div>
                  <AlertTriangle size={17} />
                  <span>Low stock products</span>
                  <strong>{data.lowStockProductCount}</strong>
                </div>
              </div>
            </section>
          </div>

          <section className="dashboard-panel quick-actions-panel">
            <div className="panel-heading">
              <div>
                <h2>Quick Actions</h2>
                <p>Common business operations</p>
              </div>
            </div>
            <div className="quick-actions-grid">
              <Link to="/pos" className="quick-action">
                <div className="quick-action-icon"><ShoppingCart size={21} /></div>
                <span>New Sale</span>
                <ArrowUpRight size={16} />
              </Link>
              <Link to="/products" className="quick-action">
                <div className="quick-action-icon"><Package size={21} /></div>
                <span>Manage Products</span>
                <ArrowUpRight size={16} />
              </Link>
              <Link to="/customers" className="quick-action">
                <div className="quick-action-icon"><Users size={21} /></div>
                <span>Customers</span>
                <ArrowUpRight size={16} />
              </Link>
              <Link to="/reports" className="quick-action">
                <div className="quick-action-icon"><ReceiptText size={21} /></div>
                <span>View Reports</span>
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </section>
          <p className="dashboard-updated">
            Last updated: {new Date(data.generatedAt).toLocaleString('en-IN')}
          </p>
        </>
      ) : !error ? (
        <p className="dashboard-empty">No dashboard data available.</p>
      ) : null}
    </div>
  );
}
