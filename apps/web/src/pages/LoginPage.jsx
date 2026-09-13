import { useSignIn } from '@clerk/react';
import { useState } from 'react';
import { loginWithPassword } from '../lib/api';
import { ForgotPasswordModal } from '../components/ForgotPasswordModal';
import { 
  Wifi, 
  ShieldCheck, 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  Building2, 
  Sparkles, 
  ArrowRight 
} from 'lucide-react';

export function LoginPage({ onAuthenticated }) {
  const { isLoaded, signIn } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState();

  async function submit(event) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await loginWithPassword(email.trim(), password);
      onAuthenticated(result.data.accessToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể đăng nhập. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setBusy(false);
    }
  }

  async function startGoogleOAuth() {
    if (busy) return;
    if (!isLoaded || !signIn) {
      setError('Dịch vụ đăng nhập Google chưa sẵn sàng. Vui lòng thử lại sau giây lát.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/oauth/callback',
        redirectUrlComplete: '/oauth/complete',
        continueSignIn: true,
        continueSignUp: true
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể bắt đầu đăng nhập qua tài khoản Google.');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.15fr_1fr] bg-slate-50 font-sans">
      {/* Left Column: Signature Brand Showcase */}
      <section className="hidden lg:flex flex-col justify-between bg-slate-950 p-12 xl:p-16 text-white relative overflow-hidden">
        {/* Ambient Glows */}
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-brand-600/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-teal-500/15 blur-3xl pointer-events-none" />

        {/* Brand Top */}
        <div className="relative z-10 flex items-center gap-3.5">
          <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-tr from-brand-600 to-teal-400 text-white font-extrabold text-xl shadow-lg shadow-brand-500/25">
            W
          </div>
          <div>
            <span className="font-extrabold text-2xl tracking-tight font-display text-white">WorkShift</span>
            <span className="ml-2 rounded-full bg-teal-500/20 border border-teal-400/30 px-2.5 py-0.5 text-xs font-semibold text-teal-300">
              Enterprise 2.0
            </span>
          </div>
        </div>

        {/* Hero Narrative */}
        <div className="relative z-10 max-w-xl my-auto py-12">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-teal-300 backdrop-blur-md mb-6">
            <Sparkles className="size-3.5 text-teal-400" />
            <span>Hệ thống Chấm công Doanh nghiệp Thế hệ Mới</span>
          </div>

          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight font-display tracking-tight text-white">
            Đúng người.<br />
            Đúng nơi.<br />
            <span className="bg-gradient-to-r from-teal-300 via-emerald-400 to-teal-200 bg-clip-text text-transparent">
              Đúng thời điểm.
            </span>
          </h1>

          <p className="mt-6 text-base xl:text-lg text-slate-300 leading-relaxed max-w-lg">
            Trải nghiệm điểm danh một chạm siêu tốc, xác minh tức thời qua địa chỉ IP Wi-Fi công ty, an toàn tuyệt đối và bảo mật thông tin nội bộ.
          </p>

          {/* Feature Highlights Grid */}
          <div className="mt-10 grid gap-4">
            <div className="glass-dark rounded-2xl p-4 flex items-start gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500/20 text-teal-400">
                <Wifi className="size-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Xác thực Mạng Doanh nghiệp</h2>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Chỉ cần kết nối đúng Wi-Fi văn phòng để chấm công, không cần GPS hay sinh trắc học phức tạp.
                </p>
              </div>
            </div>

            <div className="glass-dark rounded-2xl p-4 flex items-start gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500/20 text-teal-400">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Bảo mật chuẩn Doanh nghiệp</h2>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Hỗ trợ đăng nhập một lần OAuth2 và mã hóa toàn bộ dữ liệu.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="relative z-10 border-t border-slate-800/80 pt-6 text-xs text-slate-400 flex items-center justify-between">
          <span>© {new Date().getFullYear()} WorkShift Inc. All rights reserved.</span>
          <span>Bảo mật • Đáng tin cậy</span>
        </div>
      </section>

      {/* Right Column: Clean Authentication Form */}
      <section className="flex items-center justify-center p-6 sm:p-10 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Brand Header */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white font-bold text-lg">
              W
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight text-slate-900 font-display">WorkShift</span>
              <p className="text-xs text-slate-500">Chấm công Doanh nghiệp</p>
            </div>
          </div>

          <div className="mb-6">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 border border-brand-200/80 px-2.5 py-0.5 text-xs font-semibold text-brand-700 mb-2">
              <Building2 className="size-3.5" />
              <span>Cổng Đăng nhập Doanh nghiệp</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-display">
              Đăng nhập WorkShift
            </h1>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              Vui lòng sử dụng email và mật khẩu tài khoản đã được phân quyền để tiếp tục.
            </p>
          </div>

          {/* Form Card */}
          <div className="card shadow-lg shadow-slate-900/[0.04] border-slate-200">
            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/90 p-3.5 text-xs text-rose-800 animate-in fade-in">
                <AlertCircle className="size-4 shrink-0 text-rose-600 mt-0.5" />
                <span className="leading-relaxed font-medium">{error}</span>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Email công ty
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Mail className="size-4" />
                  </div>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="email@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input pl-10"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Mật khẩu
                  </label>
                  
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="size-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input pl-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <button
                    type="button"
                    onClick={() => setForgotPasswordOpen(true)}
                    className="text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                  >
                    Quên mật khẩu?
                  </button>
              </div>

              <button
                type="submit"
                disabled={busy || !isLoaded}
                className="btn-primary w-full mt-2"
              >
                {busy ? (
                  <span className="flex items-center gap-2">
                    <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Đang xác minh...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Đăng nhập tài khoản
                    <ArrowRight className="size-4" />
                  </span>
                )}
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-3 text-slate-400 uppercase font-semibold tracking-wider">
                    hoặc tiếp tục với
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void startGoogleOAuth()}
                className="btn-secondary w-full flex items-center justify-center gap-3"
                aria-busy={busy || !isLoaded}
              >
                <svg className="size-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.25 21.36 7.33 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.26C.46 8.16 0 9.97 0 12s.46 3.84 1.26 5.42l4.02-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.25 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                <span>Tài khoản Google</span>
              </button>
            </form>
          </div>

          {/* Helper note */}
          <div className="mt-6 text-center text-xs text-slate-500 leading-relaxed">
            Tài khoản nội bộ được cấp bởi Quản trị viên hoặc phòng Nhân sự.
            <br />
            Không có đăng ký công khai.
          </div>
        </div>
      </section>
      <ForgotPasswordModal isOpen={forgotPasswordOpen} onClose={() => setForgotPasswordOpen(false)} />
    </main>
  );
}
