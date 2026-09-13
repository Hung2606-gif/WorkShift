import { StrictMode, useEffect, useState } from 'react';
import { AuthenticateWithRedirectCallback, ClerkProvider, SignUp, useAuth, useClerk } from '@clerk/react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { ApiError, api, exchangeOAuthSession, setTokenProvider } from './lib/api';
import { SystemAdminPage } from './pages/SystemAdminPage';
import { HrPage } from './pages/HrPage';
import { AttendancePage } from './pages/AttendancePage';
import { HomePage } from './pages/HomePage';
import { EmployeeWorkspacePage } from './pages/EmployeeWorkspacePage';
import { ProfilePage } from './pages/ProfilePage';
import { LoginPage } from './pages/LoginPage';
import { ChangeTemporaryPasswordModal } from './components/ChangeTemporaryPasswordModal';
import { AlertCircle } from 'lucide-react';

const sessionKey = 'workshift-app-token';
const adminReturnSessionKey = 'workshift-admin-return-token';

function PageLoader({ label = 'Đang tải hệ thống WorkShift...' }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-5 flex items-center justify-center">
          <div className="size-14 rounded-2xl bg-gradient-to-tr from-brand-600 to-teal-500 text-white font-extrabold text-2xl flex items-center justify-center shadow-lg shadow-brand-500/25">
            W
          </div>
          <div className="absolute -inset-2 rounded-3xl border-2 border-brand-500/30 animate-pulse-ring pointer-events-none" />
        </div>
        <p className="text-sm font-bold text-slate-800 font-display">{label}</p>
        <p className="mt-1 text-xs text-slate-400">Vui lòng chờ trong giây lát</p>
      </div>
    </div>
  );
}

function OAuthRedirectCallback() {
  return (
    <>
      <PageLoader label="Đang hoàn tất đăng nhập Google..." />
      <AuthenticateWithRedirectCallback
        signInUrl="/login"
        signUpUrl="/oauth/continue"
        continueSignUpUrl="/oauth/continue"
        signInFallbackRedirectUrl="/oauth/complete"
        signUpFallbackRedirectUrl="/oauth/complete"
      />
      <div id="clerk-captcha" />
    </>
  );
}

// OAuth may transfer an unknown Google identity from sign-in to sign-up. The
// prebuilt Clerk view completes bot protection and any required profile fields,
// then returns through the WorkShift session exchange route.
function OAuthSignUpContinuation() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-md">
        <p className="mb-4 text-center text-sm font-medium text-slate-600">
          Hoàn tất thông tin đăng nhập Google
        </p>
        <SignUp
          path="/oauth/continue"
          routing="path"
          signInUrl="/login"
          fallbackRedirectUrl="/oauth/complete"
          forceRedirectUrl="/oauth/complete"
        />
      </section>
    </main>
  );
}

function OAuthSessionExchange({ onAuthenticated }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [error, setError] = useState();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    async function exchange() {
      try {
        const clerkToken = await getToken();
        const result = await exchangeOAuthSession(clerkToken);
        if (!cancelled) onAuthenticated(result.data.accessToken);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Không thể xác minh tài khoản OAuth2.');
      }
    }
    void exchange();
    return () => { cancelled = true; };
  }, [getToken, isLoaded, isSignedIn, onAuthenticated]);

  async function returnToLogin() {
    try {
      await signOut();
    } finally {
      window.location.assign('/login');
    }
  }

  if (!isLoaded || (isSignedIn && !error)) return <PageLoader label="Đang xác minh quyền truy cập Google OAuth2..." />;
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
      <section className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-7 text-center shadow-xl shadow-slate-900/[.05]">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-rose-50 text-xl text-rose-600">
          <AlertCircle className="size-6" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900 font-display">Không thể truy cập WorkShift</h1>
        <p className="mt-2 text-xs sm:text-sm leading-relaxed text-slate-600">{error ?? 'Phiên xác thực OAuth2 không hợp lệ.'}</p>
        <button className="btn-primary mt-6 inline-flex" onClick={() => void returnToLogin()}>
          Quay lại trang Đăng nhập
        </button>
      </section>
    </main>
  );
}

function App() {
  const { signOut } = useClerk();
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem(sessionKey));
  const [profile, setProfile] = useState();
  const [error, setError] = useState();

  const establishSession = (token) => {
    sessionStorage.setItem(sessionKey, token);
    setAccessToken(token);
    setError(undefined);
  };

  const clearSession = async () => {
    sessionStorage.removeItem(sessionKey);
    sessionStorage.removeItem(adminReturnSessionKey);
    setAccessToken(null);
    setProfile(undefined);
    setError(undefined);
    await signOut();
  };

  useEffect(() => { 
    setTokenProvider(() => accessToken); 
    return () => setTokenProvider(undefined); 
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    async function loadProfile() {
      try {
        const result = await api('/me');
        if (!cancelled) { 
          setProfile(result.data); 
          setError(undefined); 
        }
      } catch (reason) {
        if (!cancelled) {
          sessionStorage.removeItem(sessionKey);
          setAccessToken(null);
          setProfile(undefined);
          setError(reason instanceof Error ? reason.message : 'Không thể tải hồ sơ tài khoản WorkShift.');
        }
      }
    }
    void loadProfile();
    return () => { cancelled = true; };
  }, [accessToken]);

  if (!accessToken) {
    return (
      <Routes>
        <Route path="/login/*" element={<LoginPage onAuthenticated={establishSession} />} />
        <Route path="/oauth/callback" element={<OAuthRedirectCallback />} />
        <Route path="/oauth/complete" element={<OAuthSessionExchange onAuthenticated={establishSession} />} />
        <Route path="/oauth/continue/*" element={<OAuthSignUpContinuation />} />
        <Route path="/sign-up/*" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!profile && !error) return <PageLoader label="Đang chuẩn bị không gian làm việc của bạn..." />;
  
  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
        <section className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-7 text-center shadow-xl shadow-slate-900/[.05]">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-rose-50 text-xl text-rose-600">
            <AlertCircle className="size-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900 font-display">Không thể truy cập WorkShift</h1>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-slate-600">{error}</p>
          <button className="btn-primary mt-6" onClick={() => void clearSession()}>
            Quay lại trang Đăng nhập
          </button>
        </section>
      </main>
    );
  }

  const reload = () => {
    setProfile(undefined);
    setAccessToken((token) => token);
  };
  const startImpersonation = (token) => {
    if (!accessToken) return;
    sessionStorage.setItem(adminReturnSessionKey, accessToken);
    establishSession(token);
  };
  const stopImpersonation = () => {
    const adminToken = sessionStorage.getItem(adminReturnSessionKey);
    if (!adminToken) return;
    sessionStorage.removeItem(adminReturnSessionKey);
    establishSession(adminToken);
  };
  const impersonating = Boolean(sessionStorage.getItem(adminReturnSessionKey));

  const isAdmin = profile.role === 'ADMIN';
  const isHr = profile.role === 'HR';
  const defaultPath = isAdmin ? '/admin' : isHr ? '/hr' : '/';

  return (
    <ToastProvider>
      {Boolean(profile.is_temporary_password) && (
        <ChangeTemporaryPasswordModal
          profile={profile}
          onPasswordChanged={reload}
          onLogout={clearSession}
        />
      )}
      {impersonating && <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950"><span>Đang truy cập đại diện ở chế độ hỗ trợ, thời hạn tối đa 15 phút.</span><button className="rounded-lg bg-white px-3 py-1" onClick={stopImpersonation}>Quay lại System Admin</button></div>}
      <Routes>
        <Route path="/login/*" element={<Navigate to={defaultPath} replace />} />
        <Route path="/oauth/callback" element={<Navigate to={defaultPath} replace />} />
        <Route path="/oauth/complete" element={<Navigate to={defaultPath} replace />} />
        <Route path="/sign-up/*" element={<Navigate to="/login" replace />} />
        
        <Route element={<Layout profile={profile} onLogout={clearSession} />}>
          {/* Routes for EMPLOYEE */}
          {!isHr && !isAdmin && (
            <>
              <Route path="/" element={<EmployeeWorkspacePage profile={profile} onChanged={reload} />} />
              <Route path="/attendance" element={<AttendancePage profile={profile} onCheckin={reload} />} />
              <Route path="/profile" element={<ProfilePage profile={profile} />} />
            </>
          )}

          {/* Routes for HR */}
          {isHr && (
            <>
              <Route path="/hr" element={<HrPage profile={profile} onProfileChanged={reload} />} />
              <Route path="/profile" element={<ProfilePage profile={profile} />} />
            </>
          )}

          {/* Routes for ADMIN */}
          {isAdmin && (
            <>
              <Route path="/admin" element={<SystemAdminPage profile={profile} onImpersonate={startImpersonation} />} />
            </>
          )}

          {/* Fallback */}
          <Route path="*" element={<Navigate to={defaultPath} replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

const root = createRoot(document.getElementById('root'));
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  root.render(
    <StrictMode>
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <section className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 shadow-xl shadow-slate-900/[.05]">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600 mb-4 font-bold text-xl">
            !
          </div>
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Yêu cầu cấu hình</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 font-display">WorkShift chưa thể khởi động</h1>
          <p className="mt-3 text-xs sm:text-sm leading-relaxed text-slate-600">
            Vui lòng hoàn tất cấu hình xác thực ứng dụng trong tệp môi trường trước khi tiếp tục.
          </p>
        </section>
      </main>
    </StrictMode>
  );
} else {
  root.render(
    <StrictMode>
      <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/login">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ClerkProvider>
    </StrictMode>
  );
}
