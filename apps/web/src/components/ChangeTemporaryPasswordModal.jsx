import { useState } from 'react';
import { changeTemporaryPassword } from '../lib/api';
import { 
  ShieldAlert, 
  Lock, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle, 
  KeyRound, 
  LogOut, 
  ArrowRight,
  ShieldCheck
} from 'lucide-react';

export function ChangeTemporaryPasswordModal({ profile, onPasswordChanged, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState();

  // Real-time validation checks (Clerk policy requires 15+ characters)
  const isLengthValid = newPassword.length >= 15;
  const isDifferent = Boolean(currentPassword && newPassword && currentPassword !== newPassword);
  const isMatched = Boolean(newPassword && confirmPassword && newPassword === confirmPassword);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!currentPassword) {
      setError('Vui lòng nhập mật khẩu tạm thời hiện tại.');
      return;
    }
    if (!isLengthValid) {
      setError('Mật khẩu mới phải có tối thiểu 15 ký tự theo chính sách bảo mật hệ thống.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('Mật khẩu mới phải khác với mật khẩu tạm thời ban đầu.');
      return;
    }
    if (!isMatched) {
      setError('Xác nhận mật khẩu mới chưa trùng khớp.');
      return;
    }

    setBusy(true);
    setError(undefined);

    try {
      await changeTemporaryPassword(currentPassword, newPassword);
      if (onPasswordChanged) {
        onPasswordChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đổi mật khẩu. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Immovable backdrop */}
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md transition-opacity animate-in fade-in duration-300" />

      {/* Modal Dialog */}
      <div 
        className="relative w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-2xl shadow-slate-950/40 border border-slate-100 z-10 animate-in zoom-in-95 my-8"
        role="dialog"
        aria-modal="true"
      >
        {/* Header Badge & Icon */}
        <div className="text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-600 shadow-md shadow-amber-500/10 mb-4">
            <KeyRound className="size-7" />
          </div>
          
          <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold text-amber-800 mb-2">
            <ShieldAlert className="size-3.5 text-amber-600" />
            <span>Yêu cầu Đổi Mật khẩu Lần đầu</span>
          </div>

          <h2 className="text-2xl font-extrabold text-slate-900 font-display tracking-tight">
            Thiết lập Mật khẩu Mới
          </h2>

          <p className="mt-2 text-xs sm:text-sm text-slate-500 leading-relaxed max-w-md mx-auto">
            Tài khoản <span className="font-bold text-slate-700">{profile?.email}</span> đang sử dụng mật khẩu tạm thời do hệ thống cấp. Vui lòng đặt mật khẩu mới để bảo vệ an toàn dữ liệu doanh nghiệp.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-xs sm:text-sm text-rose-800 animate-in fade-in">
            <AlertCircle className="size-5 shrink-0 text-rose-600 mt-0.5" />
            <span className="leading-relaxed font-medium">{error}</span>
          </div>
        )}

        {/* Password Reset Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Field 1: Current Temporary Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Mật khẩu tạm thời hiện tại *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Lock className="size-4" />
              </div>
              <input
                type={showCurrent ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="Nhập mật khẩu tạm thời bạn vừa đăng nhập"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input pl-10 pr-10 text-xs sm:text-sm"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition"
                aria-label={showCurrent ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Field 2: New Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Mật khẩu mới (Tối thiểu 15 ký tự) *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <ShieldCheck className="size-4" />
              </div>
              <input
                type={showNew ? 'text' : 'password'}
                required
                minLength={15}
                autoComplete="new-password"
                placeholder="Ví dụ: WS#MyStrongPassword2026!"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input pl-10 pr-10 text-xs sm:text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition"
                aria-label={showNew ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Field 3: Confirm New Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Xác nhận mật khẩu mới *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <ShieldCheck className="size-4" />
              </div>
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                minLength={15}
                autoComplete="new-password"
                placeholder="Nhập lại mật khẩu mới"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input pl-10 pr-10 text-xs sm:text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition"
                aria-label={showConfirm ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Realtime Indicators */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <div className={`size-2 rounded-full ${isLengthValid ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={isLengthValid ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>
                Độ dài tối thiểu từ 15 ký tự trở lên
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`size-2 rounded-full ${isMatched ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className={isMatched ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>
                Mật khẩu xác nhận trùng khớp
              </span>
            </div>
          </div>

          {/* Submit Action */}
          <button
            type="submit"
            disabled={busy || !isLengthValid || !isMatched}
            className="btn-primary w-full py-3.5 mt-2 flex items-center justify-center gap-2 text-sm shadow-lg shadow-brand-600/20 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Đang lưu mật khẩu mới...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Xác nhận đổi mật khẩu & Bắt đầu làm việc
                <ArrowRight className="size-4" />
              </span>
            )}
          </button>
        </form>

        {/* Footer Alternative: Sign out */}
        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center">
          <button
            type="button"
            onClick={onLogout}
            className="text-xs font-semibold text-slate-500 hover:text-rose-600 transition flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="size-3.5" />
            <span>Đăng xuất khỏi tài khoản này</span>
          </button>
        </div>
      </div>
    </div>
  );
}
