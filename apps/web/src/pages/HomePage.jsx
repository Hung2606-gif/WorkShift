import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Wifi, 
  Clock, 
  Building2, 
  MapPin, 
  ShieldCheck, 
  ArrowRight, 
  Sparkles, 
  CalendarCheck, 
  CheckCircle2, 
  AlertCircle, 
  FileText, 
  Calendar, 
  Sun, 
  Moon, 
  Palmtree, 
  PlusCircle,
  LogOut
} from 'lucide-react';
import { 
  checkInAttendance, 
  employeeCheckOut, 
  getEmployeeSchedule, 
  getEmployeeLeaveBalance, 
  getEmployeeRequests 
} from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';

export function HomePage({ profile }) {
  const [schedule, setSchedule] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [requests, setRequests] = useState([]);
  const [busyAction, setBusyAction] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const now = new Date();
  const currentHour = now.getHours();

  let timeGreeting = 'Chào buổi sáng';
  if (currentHour >= 12 && currentHour < 18) {
    timeGreeting = 'Chào buổi chiều';
  } else if (currentHour >= 18) {
    timeGreeting = 'Chào buổi tối';
  }

  const formattedFullDate = new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(now);

  const firstName = profile.full_name?.trim().split(' ').at(-1) || 'bạn';
  const office = profile.office;

  async function loadEmployeeData() {
    try {
      const [schedRes, leaveRes, reqRes] = await Promise.allSettled([
        getEmployeeSchedule(),
        getEmployeeLeaveBalance(),
        getEmployeeRequests()
      ]);
      if (schedRes.status === 'fulfilled') setSchedule(schedRes.value.data || []);
      if (leaveRes.status === 'fulfilled') setLeaveBalance(leaveRes.value.data);
      if (reqRes.status === 'fulfilled') setRequests(reqRes.value.data || []);
    } catch {
      // Graceful fallback
    }
  }

  useEffect(() => {
    void loadEmployeeData();
  }, []);

  async function handleQuickCheckIn() {
    setBusyAction(true);
    setFeedback(null);
    try {
      const res = await checkInAttendance();
      setFeedback({ kind: 'success', text: res.message || 'Chấm công vào ca (Check-in) thành công!' });
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : 'Chấm công thất bại.' });
    } finally {
      setBusyAction(false);
    }
  }

  async function handleQuickCheckOut() {
    setBusyAction(true);
    setFeedback(null);
    try {
      await employeeCheckOut();
      setFeedback({ kind: 'success', text: 'Chấm công tan ca (Check-out) thành công!' });
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : 'Check-out thất bại.' });
    } finally {
      setBusyAction(false);
    }
  }

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* Hero Welcome Banner */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 via-brand-700 to-teal-800 px-6 py-8 sm:px-10 sm:py-10 text-white shadow-xl shadow-brand-900/10">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 size-80 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 size-64 rounded-full bg-teal-400/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 border border-white/20 px-3.5 py-1 text-xs font-semibold backdrop-blur-md mb-4 capitalize">
              <Sparkles className="size-3.5 text-teal-300" />
              <span>{formattedFullDate}</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-white">
              {timeGreeting}, <span className="text-teal-200">{firstName}</span>!
            </h1>

            <p className="mt-3 text-sm sm:text-base text-brand-100 leading-relaxed max-w-xl">
              Không gian làm việc WorkShift. Chấm công bằng kết nối mạng Wi-Fi văn phòng hoặc theo dõi lịch phân ca và đơn từ trực tuyến.
            </p>
          </div>

          <div className="shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              onClick={() => void handleQuickCheckIn()}
              disabled={busyAction}
              className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-white px-5 py-3.5 text-sm font-bold text-brand-800 shadow-lg shadow-black/10 hover:bg-teal-50 hover:scale-[1.02] active:scale-100 transition-all cursor-pointer"
            >
              <Wifi className="size-4 text-brand-600" />
              <span>Check-in Vào ca</span>
            </button>

            <button
              onClick={() => void handleQuickCheckOut()}
              disabled={busyAction}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/15 border border-white/25 px-4 py-3.5 text-sm font-bold text-white hover:bg-white/25 transition-all cursor-pointer"
            >
              <LogOut className="size-4 text-teal-200" />
              <span>Check-out Tan ca</span>
            </button>
          </div>
        </div>
      </section>

      {/* Quick Action Feedback Alert */}
      {feedback && (
        <div className={`p-4 rounded-2xl border text-xs sm:text-sm font-medium flex items-center gap-3 ${
          feedback.kind === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {feedback.kind === 'success' ? <CheckCircle2 className="size-5 text-emerald-600 shrink-0" /> : <AlertCircle className="size-5 text-rose-600 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* 3 Metric Cards for Employee */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Card 1: Leave Balance */}
        <section className="card card-hover flex flex-col justify-between p-5 border-l-4 border-l-brand-600">
          <div>
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Phép năm ({leaveBalance?.year || new Date().getFullYear()})</span>
              <Palmtree className="size-4 text-brand-600" />
            </div>
            <p className="mt-3 text-3xl font-extrabold text-slate-900 font-display">
              {leaveBalance?.remaining_days ?? 12} <span className="text-base font-medium text-slate-500">ngày còn lại</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Đã sử dụng: <b>{leaveBalance?.used_days ?? 0}</b> / Cấp: <b>{leaveBalance?.granted_days ?? 12} ngày</b>
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <Link to="/profile" className="text-brand-600 font-bold hover:underline flex items-center gap-1">
              Tạo đơn nghỉ phép →
            </Link>
          </div>
        </section>

        {/* Card 2: Upcoming Schedule */}
        <section className="card card-hover flex flex-col justify-between p-5 border-l-4 border-l-teal-600">
          <div>
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Lịch Phân ca sắp tới</span>
              <Calendar className="size-4 text-teal-600" />
            </div>
            {schedule.length > 0 ? (
              <div className="mt-3">
                <p className="text-base font-bold text-slate-900 font-display">
                  {schedule[0].work_shifts?.name || 'Ca làm việc'}
                </p>
                <p className="text-xs text-teal-700 font-medium mt-0.5">
                  Ngày: <b>{schedule[0].work_date}</b> ({schedule[0].work_shifts?.start_time?.slice(0, 5)} - {schedule[0].work_shifts?.end_time?.slice(0, 5)})
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500 italic">Chưa có lịch phân ca cụ thể.</p>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Ca trực đã xếp: {schedule.length}</span>
            <Link to="/attendance" className="text-teal-700 font-bold hover:underline">
              Vào điểm danh →
            </Link>
          </div>
        </section>

        {/* Card 3: Pending Requests */}
        <section className="card card-hover flex flex-col justify-between p-5 border-l-4 border-l-blue-600">
          <div>
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Đơn từ Đang duyệt</span>
              <FileText className="size-4 text-blue-600" />
            </div>
            <p className="mt-3 text-3xl font-extrabold text-blue-600 font-display">
              {requests.filter((r) => r.status === 'PENDING').length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Tổng số đơn đã gửi: <b>{requests.length} đơn</b>
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <Link to="/profile" className="text-blue-600 font-bold hover:underline">
              Xem lịch sử đơn từ →
            </Link>
          </div>
        </section>
      </div>

      {/* Guide Banner */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 shadow-sm">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 font-display">
          <CalendarCheck className="size-5 text-brand-600" />
          Quy định & Lưu ý Điểm danh Ca làm việc
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs sm:text-sm text-slate-600">
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="font-bold text-slate-800 mb-1">1. Kết nối Wi-Fi Văn phòng</p>
            <p className="text-xs text-slate-500">Bắt buộc kết nối đúng mạng Wi-Fi công ty trước khi bấm Check-in hoặc Check-out.</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="font-bold text-slate-800 mb-1">2. Check-in & Check-out</p>
            <p className="text-xs text-slate-500">Chấm công đầu ca và kết thúc ca để đảm bảo ghi nhận đủ thời gian công tác hợp lệ.</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
            <p className="font-bold text-slate-800 mb-1">3. Giải trình & Xin phép</p>
            <p className="text-xs text-slate-500">Nếu quên chấm công hoặc nghỉ phép, hãy tạo đơn tại trang Hồ sơ để HR phê duyệt.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
