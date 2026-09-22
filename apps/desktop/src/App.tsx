import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { useI18n } from './i18n';
import { useAuth } from './lib/auth';
import { CustomerDetail } from './pages/CustomerDetail';
import { Customers } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { Invoices } from './pages/Invoices';
import { Ledger } from './pages/Ledger';
import { License } from './pages/License';
import { Login } from './pages/Login';
import { OrderDetail } from './pages/OrderDetail';
import { OrderEditor } from './pages/OrderEditor';
import { Orders } from './pages/Orders';
import { Production } from './pages/Production';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { t } = useI18n();
  const loc = useLocation();
  if (status === 'loading') return <Loading label={t('app.restoring')} />;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

/** Land on the first screen this user is allowed to see (a field agent has no dashboard, for instance). */
function Home() {
  const { can } = useAuth();
  const { t } = useI18n();
  if (can('core.dashboard.read')) return <Dashboard />;
  if (can('sales.order.read')) return <Navigate to="/orders" replace />;
  if (can('production.order.read')) return <Navigate to="/production" replace />;
  if (can('finance.entry.read')) return <Navigate to="/ledger" replace />;
  return <div className="p-10 text-center text-muted">{t('app.nothingYet')}</div>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/new" element={<OrderEditor />} />
        <Route path="orders/:id/edit" element={<OrderEditor />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="production" element={<Production />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="license" element={<License />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
