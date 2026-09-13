import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Lock, Phone, RefreshCw } from 'lucide-react';
import { confirmPasswordReset, requestPasswordResetOtp } from '../lib/api';
import { Modal } from './Modal';

const initialForm = {
  phoneNumber: '',
  otpCode: '',
  newPassword: '',
  confirmPassword: ''
};

export function ForgotPasswordModal({ isOpen, onClose }) {
  const [step, setStep] = useState('request');
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState();
  const [notice, setNotice] = useState();
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!cooldownSeconds) return undefined;
    const timer = window.setInterval(() => {
      setCooldownSeconds((value) => Math.max(0, value - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  useEffect(() => {
    if (isOpen) return;
    setStep('request');
    setForm(initialForm);
    setBusy(false);
    setError(undefined);
    setNotice(undefined);
    setCooldownSeconds(0);
    setShowPassword(false);
  }, [isOpen]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function requestOtp(event) {
    event?.preventDefault();
    if (!form.phoneNumber.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await requestPasswordResetOtp(form.phoneNumber);
      setStep('confirm');
      setCooldownSeconds(response.data?.retryAfterSeconds ?? 60);
      setNotice('Mã xác thực gồm 6 chữ số đã được gửi đến số điện thoại của bạn.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể gửi mã xác thực. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset(event) {
    event.preventDefault();
    if (busy) return;
    if (form.newPassword.length < 15) {
      setError('Mật khẩu mới phải có ít nhất 15 ký tự.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('Xác nhận mật khẩu mới chưa trùng khớp.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await confirmPasswordReset({
        phoneNumber: form.phoneNumber,
        otpCode: form.otpCode,
        newPassword: form.newPassword
      });
      setStep('complete');
      setNotice(response.message || 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể đặt lại mật khẩu. Vui lòng kiểm tra mã OTP.');
    } finally {
      setBusy(false);
    }
  }

  const title = step === 'complete' ? 'Đặt lại mật khẩu thành công' : 'Quên mật khẩu';
  const description = step === 'request'
    ? 'Nhập số điện thoại đã đăng ký để nhận mã OTP qua SMS.'
    : step === 'confirm'
      ? 'Mã OTP có hiệu lực trong 5 phút và chỉ dùng được một lần.'
      : 'Mật khẩu mới đã được lưu an toàn.';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} dismissible={!busy} maxWidth="max-w-md">
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <span className="mt-0.5 text-rose-600">!</span>
          <span className="leading-relaxed font-medium">{error}</span>
        </div>
      )}
      {notice && (
        <div aria-live="polite" className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 mt-0.5" />
          <span className="leading-relaxed font-medium">{notice}</span>
        </div>
      )}

      {step === 'request' && (
        <form onSubmit={requestOtp} className="space-y-5">
          <div>
            <label htmlFor="reset-phone" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700">
              Số điện thoại đã đăng ký
            </label>
            <div className="relative">
              <Phone className="pointer-events-none absolute inset-y-0 left-3.5 my-auto size-4 text-slate-400" />
              <input
                id="reset-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                maxLength={30}
                placeholder="Ví dụ: 0901234567"
                value={form.phoneNumber}
                onChange={(event) => updateForm('phoneNumber', event.target.value)}
                className="input pl-10"
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Chỉ có thể yêu cầu tối đa 5 mã mỗi ngày. Mỗi lần gửi lại cần chờ 60 giây.</p>
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? <span className="flex items-center gap-2"><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />Đang gửi mã...</span> : <span className="flex items-center gap-2"><KeyRound className="size-4" />Gửi mã OTP</span>}
          </button>
        </form>
      )}

      {step === 'confirm' && (
        <form onSubmit={confirmReset} className="space-y-4">
          <div>
            <label htmlFor="reset-otp" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700">Mã OTP 6 số</label>
            <input
              id="reset-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="••••••"
              value={form.otpCode}
              onChange={(event) => updateForm('otpCode', event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="input text-center font-mono text-lg tracking-[0.5em]"
            />
          </div>
          <div>
            <label htmlFor="reset-new-password" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700">Mật khẩu mới</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute inset-y-0 left-3.5 my-auto size-4 text-slate-400" />
              <input
                id="reset-new-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={15}
                maxLength={256}
                placeholder="Ít nhất 15 ký tự"
                value={form.newPassword}
                onChange={(event) => updateForm('newPassword', event.target.value)}
                className="input pl-10 pr-10"
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="reset-confirm-password" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700">Xác nhận mật khẩu mới</label>
            <input
              id="reset-confirm-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={15}
              maxLength={256}
              placeholder="Nhập lại mật khẩu mới"
              value={form.confirmPassword}
              onChange={(event) => updateForm('confirmPassword', event.target.value)}
              className="input"
            />
          </div>
          <button type="submit" disabled={busy || form.otpCode.length !== 6} className="btn-primary w-full">
            {busy ? <span className="flex items-center gap-2"><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />Đang đặt lại mật khẩu...</span> : 'Xác nhận và đổi mật khẩu'}
          </button>
          <button type="button" disabled={busy || cooldownSeconds > 0} onClick={() => void requestOtp()} className="btn-secondary w-full text-xs disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw className="size-3.5" />
            {cooldownSeconds > 0 ? `Gửi lại mã sau ${cooldownSeconds}s` : 'Gửi lại mã OTP'}
          </button>
        </form>
      )}

      {step === 'complete' && (
        <button type="button" onClick={onClose} className="btn-primary w-full">Quay lại đăng nhập</button>
      )}
    </Modal>
  );
}
