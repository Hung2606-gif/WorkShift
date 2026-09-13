import { CheckCircle, Clock, AlertTriangle, XCircle, ShieldAlert, Check, Ban } from 'lucide-react';

export function StatusBadge({ status, flagged = false, size = 'md' }) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  if (flagged) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200/80 font-semibold text-amber-800 ${sizeClasses}`}>
        <ShieldAlert className="size-3.5 text-amber-600" />
        Cần xem xét
      </span>
    );
  }

  switch (status) {
    case 'NORMAL':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/80 font-semibold text-emerald-700 ${sizeClasses}`}>
          <CheckCircle className="size-3.5 text-emerald-600" />
          Bình thường (Đúng giờ)
        </span>
      );
    case 'LATE':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200/80 font-semibold text-amber-800 ${sizeClasses}`}>
          <Clock className="size-3.5 text-amber-600" />
          Đi muộn
        </span>
      );
    case 'EARLY_LEAVE':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200/80 font-semibold text-amber-800 ${sizeClasses}`}>
          <Clock className="size-3.5 text-amber-600" />
          Về sớm
        </span>
      );
    case 'ABSENT':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200/80 font-semibold text-rose-700 ${sizeClasses}`}>
          <XCircle className="size-3.5 text-rose-600" />
          Vắng mặt
        </span>
      );
    case 'ACTIVE':
    case true:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/80 font-semibold text-emerald-700 ${sizeClasses}`}>
          <Check className="size-3.5 text-emerald-600" />
          Đang hoạt động
        </span>
      );
    case 'INACTIVE':
    case false:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 font-semibold text-slate-600 ${sizeClasses}`}>
          <Ban className="size-3.5 text-slate-400" />
          Đã vô hiệu hóa
        </span>
      );
    default:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-slate-100 font-medium text-slate-700 ${sizeClasses}`}>
          {status}
        </span>
      );
  }
}
