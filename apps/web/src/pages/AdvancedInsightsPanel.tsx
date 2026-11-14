import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { BrainCircuit, Boxes, AlertTriangle, TrendingUp } from 'lucide-react';

type Analytics = {
  salesTrend: Array<{ date: string; invoices: number; grossSales: number; grossProfit: number }>;
  marginSummary: { taxableRevenue: number; costOfGoodsSold: number; grossProfit: number; grossMarginPercent: number };
  inventoryABC: { totalInventoryValue: number; products: Array<{ productId: string; name: string; sku?: string; classification: string; inventoryValue: number }> };
  deadStock: { inactivityDays: number; count: number; inventoryValue: number; products: Array<{ productId: string; name: string; sku?: string; inventoryValue: number }> };
};
type Insight = { severity: 'HIGH' | 'MEDIUM' | 'INFO'; title: string; explanation: string; suggestedAction: string };
type Assistant = { mode: string; disclaimer: string; insights: Insight[] };
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0);

export default function AdvancedInsightsPanel({ from, to }: { from: string; to: string }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([
      api.get<Analytics>('/reports/analytics/overview', { params: { from, to } }),
      api.get<Assistant>('/reports/assistant/insights', { params: { from, to } }),
    ]).then(([a, b]) => { if (active) { setAnalytics(a.data); setAssistant(b.data); } })
      .catch(() => { if (active) setError('Advanced analytics and business insights could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);
  const maxSales = Math.max(1, ...(analytics?.salesTrend || []).map(row => row.grossSales));
  return <section className="reports-advanced">
    <header><div><span>ADVANCED DECISION SUPPORT</span><h2>Business intelligence & assistant</h2><p>Margin, inventory concentration, slow-moving stock and explainable operational signals.</p></div><BrainCircuit size={22}/></header>
    {error && <p className="reports-error">{error}</p>}
    {loading ? <p className="reports-empty">Analyzing selected period…</p> : analytics && <>
      <div className="reports-advanced-metrics">
        <article><small>Gross margin</small><strong>{analytics.marginSummary.grossMarginPercent.toFixed(1)}%</strong><span>{money(analytics.marginSummary.grossProfit)} gross profit</span></article>
        <article><small>Inventory at cost</small><strong>{money(analytics.inventoryABC.totalInventoryValue)}</strong><span>{analytics.inventoryABC.products.length} products analysed (maximum 500)</span></article>
        <article><small>Slow-moving stock</small><strong>{analytics.deadStock.count}</strong><span>{money(analytics.deadStock.inventoryValue)} with no movement in 90 days</span></article>
      </div>
      <div className="reports-advanced-grid">
        <div><h3><TrendingUp size={16}/> Daily sales & gross profit</h3>{analytics.salesTrend.length ? analytics.salesTrend.slice(-14).map(row=><div className="reports-trend-row" key={row.date}><span>{new Date(row.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</span><div><i style={{width:(row.grossSales/maxSales*100)+'%'}}/></div><b>{money(row.grossSales)}</b></div>) : <p className="reports-empty">No issued sales in this period.</p>}</div>
        <div><h3><Boxes size={16}/> Inventory ABC classification</h3>{analytics.inventoryABC.products.slice(0,8).map(row=><div className="reports-abc-row" key={row.productId}><span className={'reports-abc-tag '+row.classification.toLowerCase()}>{row.classification}</span><strong>{row.name}</strong><b>{money(row.inventoryValue)}</b></div>)}</div>
      </div>
      <div className="reports-deadstock"><h3><AlertTriangle size={16}/> Slow-moving inventory candidates</h3>{analytics.deadStock.products.length ? analytics.deadStock.products.slice(0,6).map(row=><span key={row.productId}>{row.name} · {money(row.inventoryValue)}</span>) : <p>No stock without a recorded movement in the 90-day screening window.</p>}</div>
    </>}
    <div className="reports-assistant"><h3><BrainCircuit size={17}/> Business assistant recommendations</h3>{loading ? <p className="reports-empty">Preparing recommendations…</p> : assistant?.insights.map((item,index)=><article key={item.title+index} className={'reports-insight '+item.severity.toLowerCase()}><div><b>{item.title}</b><span>{item.severity}</span></div><p>{item.explanation}</p><small>Suggested action: {item.suggestedAction}</small></article>)}
    {assistant?.disclaimer && <p className="reports-note">{assistant.disclaimer}</p>}</div>
  </section>;
}
