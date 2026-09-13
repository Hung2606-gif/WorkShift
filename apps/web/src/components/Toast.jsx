import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback(({ title, message, type = 'info', duration = 4500 }) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2.5 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${
              toast.type === 'success'
                ? 'border-emerald-200 bg-white/95 text-emerald-950 shadow-emerald-500/10'
                : toast.type === 'error'
                ? 'border-rose-200 bg-white/95 text-rose-950 shadow-rose-500/10'
                : toast.type === 'warning'
                ? 'border-amber-200 bg-white/95 text-amber-950 shadow-amber-500/10'
                : 'border-slate-200 bg-white/95 text-slate-900 shadow-slate-500/10'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {toast.type === 'success' && <CheckCircle2 className="size-5 text-emerald-600" />}
              {toast.type === 'error' && <AlertCircle className="size-5 text-rose-600" />}
              {toast.type === 'warning' && <AlertTriangle className="size-5 text-amber-600" />}
              {toast.type === 'info' && <Info className="size-5 text-brand-600" />}
            </div>
            <div className="flex-1 min-w-0">
              {toast.title && <p className="text-sm font-bold leading-tight">{toast.title}</p>}
              {toast.message && <p className="mt-0.5 text-xs leading-relaxed opacity-90">{toast.message}</p>}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              aria-label="Đóng thông báo"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
