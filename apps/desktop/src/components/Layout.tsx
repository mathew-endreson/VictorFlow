import { ClipboardList, Factory, IdCard, KeyRound, LayoutDashboard, ListChecks, LogOut, Menu, Receipt, Scale, Users, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '@victorflow/types';
import { useAuth } from '@/lib/auth';
import { useI18n, type Key } from '@/i18n';
import { BrandLockup } from './Brand';
import { LanguageSwitch } from './LanguageSwitch';
import { cx } from './cx';

const P = PERMISSIONS;

interface NavItem { to: string; label: Key; icon: LucideIcon; needs: string[] }
const NAV: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, needs: [P.CORE_DASHBOARD_READ] },
  { to: '/customers', label: 'nav.customers', icon: Users, needs: [P.CRM_CUSTOMER_READ] },
  { to: '/orders', label: 'nav.orders', icon: ClipboardList, needs: [P.SALES_ORDER_READ] },
  { to: '/production', label: 'nav.production', icon: Factory, needs: [P.PRODUCTION_ORDER_READ] },
  { to: '/employees', label: 'nav.employees', icon: IdCard, needs: [P.CORE_USER_READ] },
  { to: '/tasks', label: 'nav.tasks', icon: ListChecks, needs: [P.WORKFORCE_TASK_READ] },
  { to: '/ledger', label: 'nav.ledger', icon: Scale, needs: [P.FINANCE_ENTRY_READ] },
  { to: '/invoices', label: 'nav.invoices', icon: Receipt, needs: [P.FINANCE_INVOICE_READ] },
  { to: '/license', label: 'nav.license', icon: KeyRound, needs: [P.CORE_LICENSE_READ] },
];

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');

export function Layout() {
  const { user, can, logout } = useAuth();
  const { t, label, fmt } = useI18n();
  const nav = useNavigate();
  const items = NAV.filter((n) => can(...n.needs));
  // Below the `lg` breakpoint the sidebar is a slide-over drawer opened from a top bar; from `lg` up it is the fixed column.
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <header className="flex shrink-0 items-center justify-between gap-3 bg-side px-4 py-3 text-white lg:hidden">
        <BrandLockup compact />
        <button type="button" aria-label={t('nav.openMenu')} aria-expanded={open} aria-controls="app-sidebar" onClick={() => setOpen(true)} className="rounded-md p-2 transition hover:bg-white/10">
          <Menu aria-hidden className="size-5" />
        </button>
      </header>
      {open && <div aria-hidden className="fixed inset-0 z-30 bg-black/55 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        id="app-sidebar"
        className={cx(
          'flex w-64 shrink-0 flex-col bg-side text-sideink',
          'fixed inset-y-0 start-0 z-40 transition-transform duration-200 lg:static',
          // closed = off-canvas, but ONLY below lg (a bare rtl: variant would also push the desktop sidebar off-screen in Arabic)
          open ? 'translate-x-0 shadow-pop' : 'max-lg:invisible max-lg:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex items-start justify-between px-5 pb-5 pt-6 text-white">
          <BrandLockup compact />
          <button type="button" aria-label={t('nav.closeMenu')} onClick={() => setOpen(false)} className="-me-2 -mt-1 rounded-md p-2 text-sideink transition hover:bg-white/10 hover:text-white lg:hidden">
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label={t('nav.main')}>
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => cx('relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[0.9rem] font-medium transition', isActive ? 'bg-side2 text-white' : 'hover:bg-white/5 hover:text-white')}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span aria-hidden className="slash absolute start-0 top-1/2 -mt-3 text-2xl" />}
                  <n.icon aria-hidden className={cx('ms-2 size-[1.125rem] shrink-0', isActive && 'text-brand')} strokeWidth={1.9} />
                  {t(n.label)}
                </>
              )}
            </NavLink>
          ))}
          {items.length === 0 && <p className="px-3 py-2 text-xs opacity-70">{t('nav.noScreens')}</p>}
        </nav>

        <div className="space-y-3 border-t border-white/10 p-4">
          <LanguageSwitch tone="dark" className="w-full justify-between" />
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{initials(user?.fullName ?? '')}</span>
            <div className="min-w-0 flex-1 text-xs leading-tight">
              <div className="truncate text-sm font-semibold text-white">{user?.fullName}</div>
              <div className="mt-0.5 truncate opacity-70">{fmt.list((user?.roles ?? []).map((r) => label('role', r)))}</div>
            </div>
          </div>
          <button
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-[0.8125rem] font-medium text-sideink transition hover:bg-white/8 hover:text-white"
            onClick={async () => {
              await logout();
              nav('/login');
            }}
          >
            <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('common.signOut')}
          </button>
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[88rem] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
