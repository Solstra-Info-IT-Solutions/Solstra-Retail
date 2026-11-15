import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const AccountSecurityPage = lazy(() => import('./pages/AccountSecurityPage'));
const PlatformApprovalsPage = lazy(() => import('./pages/PlatformApprovalsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
import DashboardLayout from './layouts/DashboardLayout';
const POSPage = lazy(() => import('./pages/POSPage'));
const SalesPage = lazy(() => import('./pages/SalesPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const AdvancedInventoryPage = lazy(() => import('./pages/AdvancedInventoryPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'));
const BranchesPage = lazy(() => import('./pages/BranchesPage'));
const StaffPage = lazy(() => import('./pages/StaffPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const PromotionsPage = lazy(() => import('./pages/PromotionsPage'));
const PlatformOperationsPage = lazy(() => import('./pages/PlatformOperationsPage'));
const BusinessServicesPage = lazy(() => import('./pages/BusinessServicesPage'));

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Suspense fallback={<div className="app-loading" role="status" aria-live="polite">Loading workspace…</div>}>
    <Routes>
      <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />
      <Route
        path="/login"
        element={
          isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />
        }
      />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pos" element={<POSPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/advanced" element={<AdvancedInventoryPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/branches" element={<BranchesPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/promotions" element={<PromotionsPage />} />
          <Route path="/platform" element={<PlatformOperationsPage />} />
          <Route path="/platform/approvals" element={<PlatformApprovalsPage />} />
          <Route path="/account/security" element={<AccountSecurityPage />} />
          <Route path="/business-services" element={<BusinessServicesPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
