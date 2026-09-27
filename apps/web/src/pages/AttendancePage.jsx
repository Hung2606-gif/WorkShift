import { useEffect, useState } from 'react';
import { 
  checkInAttendance, 
  employeeCheckOut, 
  getEmployeeAttendance 
} from '../lib/api';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  ShieldCheck, 
  RefreshCw, 
  MapPin, 
  Building, 
  Calendar, 
  LogOut, 
  History 
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';

export function AttendancePage({ profile, onCheckin }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState();
  const [history, setHistory] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

  async function loadHistory() {
    try {
      const res = await getEmployeeAttendance(selectedMonth);
      setHistory(res.data || []);
    } catch {
      // Ignore initial load history errors
    }
  }

  useEffect(() => {
    void loadHistory();
  }, [selectedMonth]);

  async function handleCheckIn() {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await checkInAttendance();
      const timestamp = new Date();
      setNotice({
        kind: 'success',
        title: 'Check-in Thành công!',
        text: result.message || 'Hệ thống đã ghi nhận thời gian bắt đầu ca làm việc của bạn.',
        time: timestamp
      });
      await loadHistory();
      if (onCheckin) onCheckin();
    } catch (error) {
      setNotice({
        kind: 'error',
        title: 'Check-in Không thành công',
        text: error instanceof Error ? error.message : 'Không thể kết nối máy chủ để chấm công.'
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckOut() {
    setBusy(true);
    setNotice(undefined);
    try {
      await employeeCheckOut();
      const timestamp = new Date();
      setNotice({
        kind: 'success',
        title: 'Check-out Thành công!',
        text: 'Hệ thống đã ghi nhận thời gian kết thúc ca làm việc của bạn.',
        time: timestamp
      });
      await loadHistory();
    } catch (error) {
      setNotice({
        kind: 'error',
        title: 'Check-out Không thành công',
        text: error instanceof Error ? error.message : 'Không thể thực hiện check-out.'
      });
    } finally {
      setBusy(false);
    }
  }

  const office = profile?.office;

  return (
    <div className="mx-auto max-w-4xl space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 border border-brand-200 px-3 py-1 text-xs font-bold text-brand-700 mb-2">
          <MapPin className="size-3.5" />
          <span>Xác thực Vị trí GPS</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-display">
          Chấm công & Điểm danh
        </h1>
        <p className="mt-2 text-sm sm:text-base text-slate-500 max-w-lg mx-auto leading-relaxed">
          Có mặt tại địa điểm làm việc và cho phép truy cập vị trí để Check-in đầu ca hoặc Check-out kết thúc ca.
        </p>
      </div>

      {/* Main Check-in / Check-out Hub */}
      <section className="card p-6 sm:p-10 text-center relative overflow-hidden shadow-lg shadow-slate-900/[0.04]">
        {/* Radar Scanner Animation Background */}
        <div className="relative mx-auto my-4 size-48 sm:size-56 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-brand-500/20 animate-pulse-ring" />
          <div className="absolute inset-4 rounded-full border border-brand-500/30" />
          <div className="absolute inset-8 rounded-full border border-dashed border-brand-500/40" />

          {/* Central Glowing Icon */}
          <div className="size-24 sm:size-28 rounded-full bg-gradient-to-tr from-brand-700 via-brand-600 to-teal-500 text-white shadow-xl shadow-brand-700/30 flex flex-col items-center justify-center">
            {busy ? (
              <RefreshCw className="size-8 animate-spin text-white" />
            ) : (
              <MapPin className="size-8" />
            )}
          </div>
        </div>

        {/* Two Big Action Buttons */}
        <div className="max-w-md mx-auto mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCheckIn()}
            className="btn-primary py-3.5 text-sm shadow-md shadow-brand-600/25 flex items-center justify-center gap-2 cursor-pointer"
          >
            <CheckCircle2 className="size-5" />
            <span>Check-in Vào ca</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCheckOut()}
            className="btn-secondary py-3.5 text-sm border-slate-300 text-slate-800 hover:bg-slate-100 flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="size-5 text-slate-600" />
            <span>Check-out Tan ca</span>
          </button>
        </div>

        {/* Feedback Alert Banner */}
        {notice && (
          <div
            className={`mt-8 rounded-2xl border p-5 text-left transition-all animate-in zoom-in-95 ${
              notice.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50/90 text-emerald-950'
                : 'border-rose-200 bg-rose-50/90 text-rose-950'
            }`}
          >
            <div className="flex items-start gap-3.5">
              {notice.kind === 'success' ? (
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 mt-0.5">
                  <CheckCircle2 className="size-5" />
                </div>
              ) : (
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700 mt-0.5">
                  <AlertTriangle className="size-5" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm sm:text-base">{notice.title}</h3>
                <p className="mt-1 text-xs sm:text-sm leading-relaxed opacity-90">{notice.text}</p>

                {notice.kind === 'success' && notice.time && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 pt-3 border-t border-emerald-200/60 text-xs font-semibold text-emerald-800">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" />
                      Thời gian: {notice.time.toLocaleTimeString('vi-VN')} ({notice.time.toLocaleDateString('vi-VN')})
                    </span>
                  </div>
                )}

                {notice.kind === 'error' && (
                  <div className="mt-3 text-xs text-rose-700 bg-white/60 rounded-xl p-3 border border-rose-200/60 space-y-1">
                    <p className="font-bold">Gợi ý khắc phục sự cố:</p>
                    <ul className="list-disc list-inside space-y-0.5 opacity-90">
                      <li>Cho phép trình duyệt truy cập vị trí và bật định vị chính xác (GPS).</li>
                      <li>Nếu tín hiệu GPS yếu, hãy ra gần cửa sổ hoặc khu vực thoáng rồi thử lại.</li>
                      <li>Nếu bạn đang ở văn phòng nhưng vẫn bị báo ngoài bán kính, hãy báo Quản lý nhân sự (HR).</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Office details preview */}
        {office && (
          <div className="mt-8 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-500">
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              <Building className="size-4 text-brand-600" />
              Chi nhánh: <b>{office.name}</b>
            </span>
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              <MapPin className="size-4 text-blue-600" />
              Bán kính an toàn: <b>{office.radius_meters || 50}m</b>
            </span>
          </div>
        )}
      </section>

      {/* Monthly Attendance History Section */}
      <section className="card p-0 overflow-hidden shadow-sm">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="size-5 text-brand-600" />
            <h2 className="text-base font-bold text-slate-900 font-display">Lịch sử Chấm công Cá nhân</h2>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-semibold">Tháng:</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="input py-1 text-xs max-w-[150px]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Ngày & Giờ Check-in</th>
                <th className="px-5 py-3.5">Giờ Check-out</th>
                <th className="px-5 py-3.5">Trạng thái</th>
                <th className="px-5 py-3.5">Ghi chú điều chỉnh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-5 py-3.5 font-mono text-xs">
                    {log.check_in_time ? new Date(log.check_in_time).toLocaleString('vi-VN') : '-'}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs">
                    {log.check_out_time ? new Date(log.check_out_time).toLocaleString('vi-VN') : '-'}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={log.status} size="sm" />
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">
                    {log.adjustment_note || '-'}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-400">
                    Không có bản ghi điểm danh nào trong tháng này.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
