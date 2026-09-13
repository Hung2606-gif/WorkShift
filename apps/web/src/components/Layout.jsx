import { useState, useEffect } from 'react';
import { UserButton, useClerk } from '@clerk/react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Wifi, 
  ShieldCheck, 
  Building2, 
  LogOut, 
  Menu, 
  X, 
  Clock, 
  User,
  Briefcase,
  Layers
} from 'lucide-react';

const roleConfig = {
  ADMIN: { 
    label: 'Quản trị viên Hệ thống', 
    shortLabel: 'ADMIN',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    logoGradient: 'from-indigo-700 via-indigo-600 to-brand-700',
    homePath: '/admin'
  },
  HR: { 
    label: 'Quản lý Nhân sự', 
    shortLabel: 'HR',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    logoGradient: 'from-emerald-700 via-emerald-600 to-teal-700',
    homePath: '/hr'
  },
  EMPLOYEE: { 
    label: 'Nhân viên Công ty', 
    shortLabel: 'Nhân viên',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    logoGradient: 'from-brand-700 via-brand-600 to-teal-600',
    homePath: '/'
  }
};

export function Layout({ profile, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useClerk();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Live real-time clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const isAdmin = profile.role === 'ADMIN';
  const isHr = profile.role === 'HR';
  const isEmployee = profile.role === 'EMPLOYEE' || (!isAdmin && !isHr);

  const roleMeta = roleConfig[profile.role] || roleConfig.EMPLOYEE;

  // Tailored Navigation Items per Role
  let navItems = [];
  if (isAdmin) {
    navItems = [
      { to: '/admin', label: 'Trung tâm Quản trị', icon: ShieldCheck, exact: true }
    ];
  } else if (isHr) {
    navItems = [
      { to: '/hr', label: 'Cổng Nhân sự (HR)', icon: Briefcase, exact: true },
      { to: '/profile', label: 'Hồ sơ Cá nhân', icon: User }
    ];
  } else {
    // EMPLOYEE
    navItems = [
      { to: '/', label: 'Bảng làm việc', icon: LayoutDashboard, exact: true },
      { to: '/attendance', label: 'Điểm danh Wi-Fi', icon: Wifi },
      { to: '/profile', label: 'Hồ sơ & Ca làm', icon: User }
    ];
  }

  const formattedTime = new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(currentTime);

  const formattedDate = new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(currentTime);

  const initial = profile.full_name?.trim().charAt(0).toUpperCase() || 'W';

  async function handleSignOut() {
    if (onLogout) {
      await onLogout();
    } else {
      await signOut({ redirectUrl: '/login' });
      navigate('/login');
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-40 glass-header">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-6">
            <NavLink 
              to={roleMeta.homePath} 
              className="flex items-center gap-3 group focus:outline-none"
            >
              <div className={`grid size-10 place-items-center rounded-xl bg-gradient-to-br ${roleMeta.logoGradient} text-white font-bold text-lg shadow-md shadow-slate-900/10 group-hover:scale-105 transition-transform`}>
                W
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-lg tracking-tight text-slate-900 font-display">
                    WorkShift
                  </span>
                  <span className={`hidden sm:inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleMeta.badgeClass}`}>
                    {roleMeta.shortLabel}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 -mt-0.5 hidden sm:block">
                  Hệ thống Chấm công Doanh nghiệp
                </span>
              </div>
            </NavLink>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-1.5 ml-4 pl-4 border-l border-slate-200" aria-label="Thanh điều hướng chính">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.exact}
                    className={({ isActive }) =>
                      `nav-link ${isActive ? 'nav-link-active' : ''}`
                    }
                  >
                    <Icon className="size-4 opacity-80" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>

          {/* Right Area: Real-time clock & User Actions */}
          <div className="flex items-center gap-3">
            {/* Live Clock Ticker */}
            <div className="hidden lg:flex items-center gap-2 rounded-xl bg-slate-100/80 border border-slate-200/60 px-3 py-1.5 text-xs text-slate-600">
              <Clock className="size-3.5 text-brand-600 animate-pulse" />
              <span className="font-semibold text-slate-900 font-mono">{formattedTime}</span>
              <span className="text-slate-300">|</span>
              <span className="capitalize">{formattedDate}</span>
            </div>

            {/* User Profile Badge */}
            <div className="hidden sm:flex items-center gap-3 pl-2">
              <div className="text-right">
                <p className="max-w-[160px] truncate text-xs font-bold text-slate-900">
                  {profile.full_name || profile.email}
                </p>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <span className={`inline-block rounded-full border px-2 py-0.2 text-[10px] font-semibold ${roleMeta.badgeClass}`}>
                    {roleMeta.label}
                  </span>
                </div>
              </div>
            </div>

            {/* Clerk Avatar Dropdown */}
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full ring-2 ring-brand-500/20 ring-offset-2 ring-offset-white overflow-hidden flex items-center justify-center bg-brand-100 text-brand-800 font-bold text-sm">
                <UserButton 
                  afterSignOutUrl="/login"
                  appearance={{
                    elements: {
                      avatarBox: 'size-9'
                    }
                  }}
                />
              </div>

              {/* Logout Button */}
              <button
                onClick={() => void handleSignOut()}
                title="Đăng xuất khỏi WorkShift"
                className="hidden sm:flex size-9 items-center justify-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
              >
                <LogOut className="size-4" />
              </button>

              {/* Mobile Menu Toggle Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition"
                aria-label="Mở menu điều hướng"
              >
                {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Dropdown Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-slate-200 bg-white px-4 pt-3 pb-5 shadow-xl animate-in slide-in-from-top-4 duration-200">
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3 border border-slate-100">
              <div className={`grid size-10 place-items-center rounded-full bg-gradient-to-br ${roleMeta.logoGradient} text-white font-bold`}>
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm text-slate-900 truncate">{profile.full_name}</p>
                <p className="text-xs text-slate-500 truncate">{profile.email}</p>
                <span className={`inline-block mt-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleMeta.badgeClass}`}>
                  {roleMeta.label}
                </span>
              </div>
            </div>

            <nav className="flex flex-col gap-1.5" aria-label="Menu di động">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.exact}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
                        isActive
                          ? 'bg-brand-50 text-brand-700 border border-brand-100'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`
                    }
                  >
                    <Icon className="size-4 text-brand-600" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}

              <button
                onClick={() => void handleSignOut()}
                className="mt-3 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 transition border border-rose-100"
              >
                <LogOut className="size-4" />
                <span>Đăng xuất tài khoản</span>
              </button>
            </nav>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200/80 bg-white py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 font-display">WorkShift</span>
            <span>• Nền tảng Chấm công & Quản trị Doanh nghiệp</span>
          </div>
          <p>© {new Date().getFullYear()} WorkShift. Phân quyền đa tầng & Bảo mật dữ liệu.</p>
        </div>
      </footer>
    </div>
  );
}
