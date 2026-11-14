import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, Users, Warehouse,
  Truck, ClipboardList, BarChart3, Settings, ReceiptText, Building2,
  Menu, X, LogOut, Search, Languages
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import './DashboardLayout.css';

const navigation = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'POS Billing', path: '/pos', icon: ShoppingCart },
  { label: 'Sales Register', path: '/sales', icon: ReceiptText },
  { label: 'Products', path: '/products', icon: Package },
  { label: 'Inventory', path: '/inventory', icon: Warehouse },
  { label: 'Customers', path: '/customers', icon: Users },
  { label: 'Suppliers', path: '/suppliers', icon: Truck },
  { label: 'Purchases', path: '/purchases', icon: ClipboardList },
  { label: 'Branches & Warehouses', path: '/branches', icon: Building2 },
  { label: 'Reports', path: '/reports', icon: BarChart3 },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();

  return (
    <div className="dashboard-shell">
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`dashboard-sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-symbol">S</div>
          <div>
            <strong>Solstra</strong>
            <span>RETAIL</span>
          </div>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="sidebar-navigation">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/dashboard'}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-avatar">
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="sidebar-user-info">
            <strong>{user?.name || 'User'}</strong>
            <span>{user?.role || 'Member'}</span>
          </div>
          <button className="logout-button" onClick={logout} title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <button
            className="mobile-menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </button>

          <div className="topbar-search">
            <Search size={18} />
            <input type="search" placeholder="Search anything..." />
            <kbd>Ctrl K</kbd>
          </div>

          <div className="topbar-actions">
            <button className="language-button">
              <Languages size={18} />
              <span>EN</span>
            </button>
            <div className="topbar-avatar">
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
          </div>
        </header>

        <section className="dashboard-content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}

