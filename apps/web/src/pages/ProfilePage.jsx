import { useEffect, useState } from 'react';
import { 
  getEmployeeLeaveBalance, 
  getEmployeeRequests, 
  createEmployeeRequest, 
  updateEmployeeProfile 
} from '../lib/api';
import { Modal } from '../components/Modal';
import { 
  User, 
  Mail, 
  Building2, 
  ShieldCheck, 
  MapPin, 
  Globe, 
  Clock, 
  Calendar, 
  FileText, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  Palmtree, 
  Phone, 
  Save 
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';

const requestDefaults = {
  requestType: 'LEAVE',
  startAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
  endAt: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 16),
  reason: ''
};

export function ProfilePage({ profile, onUpdateProfile }) {
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState();
  const [notice, setNotice] = useState();

  // Profile Edit Form State
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');

  // Request Modal State
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestForm, setRequestForm] = useState(requestDefaults);

  async function loadData() {
    try {
      const [leaveRes, reqRes] = await Promise.all([
        getEmployeeLeaveBalance(),
        getEmployeeRequests()
      ]);
      setLeaveBalance(leaveRes.data);
      setRequests(reqRes.data || []);
    } catch {
      // Graceful fallback
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await updateEmployeeProfile({
        fullName: fullName.trim(),
        phone: phone.trim() || null
      });
      setNotice('Đã cập nhật thông tin cá nhân thành công!');
      if (onUpdateProfile) onUpdateProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật hồ sơ.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRequestSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const payload = {
        requestType: requestForm.requestType,
        startAt: new Date(requestForm.startAt).toISOString(),
        endAt: new Date(requestForm.endAt).toISOString(),
        reason: requestForm.reason.trim()
      };
      await createEmployeeRequest(payload);
      setRequestModalOpen(false);
      setRequestForm(requestDefaults);
      setNotice('Đã gửi đơn trực tuyến tới Quản lý nhân sự (HR) thành công!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi đơn.');
    } finally {
      setBusy(false);
    }
  }

  const office = profile?.office;

  return (
    <div className="mx-auto max-w-4xl space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-display">
          Hồ sơ & Đơn từ Cá nhân
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500">
          Quản lý thông tin tài khoản, theo dõi quỹ phép năm và nộp đơn xin nghỉ, làm thêm giờ hoặc giải trình.
        </p>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs sm:text-sm text-rose-800 animate-in fade-in">
          <AlertCircle className="size-5 shrink-0 text-rose-600 mt-0.5" />
          <span className="leading-relaxed font-medium">{error}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm text-emerald-800 animate-in fade-in">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600 mt-0.5" />
          <span className="leading-relaxed font-medium">{notice}</span>
        </div>
      )}

      {/* Leave Balance Banner */}
      {leaveBalance && (
        <section className="card p-6 border-l-4 border-l-brand-600 bg-gradient-to-r from-emerald-50/50 to-transparent">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 uppercase tracking-wider mb-1">
                <Palmtree className="size-4" />
                Quỹ Phép năm ({leaveBalance.year})
              </span>
              <p className="text-3xl font-extrabold text-slate-900 font-display mt-1">
                {leaveBalance.remaining_days} <span className="text-sm font-semibold text-slate-500">ngày phép còn lại</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Tổng phép được cấp: <b>{leaveBalance.granted_days} ngày</b> | Đã sử dụng: <b>{leaveBalance.used_days} ngày</b>
              </p>
            </div>

            <button
              onClick={() => setRequestModalOpen(true)}
              className="btn-primary text-xs sm:text-sm shrink-0"
            >
              <Plus className="size-4" />
              <span>Tạo đơn Nghỉ phép / OT</span>
            </button>
          </div>
        </section>
      )}

      {/* Profile Form & Office Details Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Personal Details Form */}
        <section className="card p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <User className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 font-display">Thông tin Cá nhân</h2>
              <p className="text-xs text-slate-500">Cập nhật họ tên và số điện thoại liên hệ</p>
            </div>
          </div>

          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Họ và tên
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Email tài khoản
              </label>
              <input
                type="email"
                disabled
                value={profile.email}
                className="input text-xs sm:text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Số điện thoại liên lạc
              </label>
              <input
                type="tel"
                placeholder="0912345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={busy}
                className="btn-primary w-full text-xs sm:text-sm"
              >
                <Save className="size-4" />
                <span>Lưu thông tin</span>
              </button>
            </div>
          </form>
        </section>

        {/* Assigned Office Info */}
        <section className="card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  <Building2 className="size-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 font-display">Chi nhánh Trực thuộc</h2>
                  <p className="text-xs text-slate-500">Văn phòng và ca làm việc mặc định</p>
                </div>
              </div>
              <StatusBadge status={profile.is_active ? 'ACTIVE' : 'INACTIVE'} size="sm" />
            </div>

            {office ? (
              <div className="space-y-3 text-xs text-slate-600">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <p className="font-bold text-slate-900 text-sm">{office.name}</p>
                  <p className="text-slate-500 mt-1">Bán kính hợp lệ: <b>{office.radius_meters || 50}m</b></p>
                </div>

                <div className="flex items-center gap-2 text-slate-600">
                  <MapPin className="size-4 text-blue-500 shrink-0" />
                  <span>Tọa độ: {office.latitude}, {office.longitude}</span>
                </div>

                <div className="flex items-center gap-2 text-slate-600">
                  <Clock className="size-4 text-emerald-600 shrink-0" />
                  <span>Khung giờ ca: <b>{office.work_start?.slice(0, 5) || '08:30'} - {office.work_end?.slice(0, 5) || '17:30'}</b></span>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-400">
                Bạn chưa được phân công phòng ban. Vui lòng liên hệ HR.
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Vai trò: <b>{profile.role}</b></span>
            <span>Quyền riêng tư được bảo vệ</span>
          </div>
        </section>
      </div>

      {/* Submitted Requests History Table */}
      <section className="card p-0 overflow-hidden shadow-sm">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-brand-600" />
            <h2 className="text-base font-bold text-slate-900 font-display">Lịch sử Đơn từ Đã gửi ({requests.length})</h2>
          </div>

          <button
            onClick={() => setRequestModalOpen(true)}
            className="btn-primary text-xs"
          >
            <Plus className="size-3.5" />
            <span>Tạo đơn mới</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Loại đơn</th>
                <th className="px-5 py-3.5">Thời gian</th>
                <th className="px-5 py-3.5">Lý do</th>
                <th className="px-5 py-3.5">Trạng thái</th>
                <th className="px-5 py-3.5">Phản hồi từ HR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                      r.request_type === 'LEAVE' ? 'bg-blue-100 text-blue-800' :
                      r.request_type === 'OVERTIME' ? 'bg-purple-100 text-purple-800' :
                      'bg-amber-100 text-amber-800'
                    }`}>
                      {r.request_type === 'LEAVE' ? 'Nghỉ phép' : r.request_type === 'OVERTIME' ? 'Làm thêm giờ (OT)' : 'Giải trình điểm danh'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-600">
                    {new Date(r.start_at).toLocaleString('vi-VN')}
                    <br />đến {new Date(r.end_at).toLocaleString('vi-VN')}
                  </td>
                  <td className="px-5 py-3.5 text-slate-700 max-w-xs truncate" title={r.reason}>
                    {r.reason}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                      r.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' :
                      'bg-amber-100 text-amber-800'
                    }`}>
                      {r.status === 'APPROVED' ? 'Đã duyệt' : r.status === 'REJECTED' ? 'Từ chối' : 'Đang chờ duyệt'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">
                    {r.review_note || '-'}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    Bạn chưa gửi đơn nào. Hãy nhấn "Tạo đơn mới" khi cần xin nghỉ phép, làm thêm giờ hoặc giải trình.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal: Create Employee Request */}
      <Modal
        isOpen={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        title="Tạo Đơn Trực tuyến"
        description="Gửi đơn xin nghỉ phép, làm thêm giờ hoặc giải trình quên điểm danh tới Quản lý nhân sự."
      >
        <form onSubmit={handleCreateRequestSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Loại đơn *
            </label>
            <select
              value={requestForm.requestType}
              onChange={(e) => setRequestForm({ ...requestForm, requestType: e.target.value })}
              className="input text-xs sm:text-sm"
            >
              <option value="LEAVE">Đơn xin nghỉ phép (LEAVE)</option>
              <option value="OVERTIME">Đơn làm thêm giờ (OVERTIME)</option>
              <option value="EXPLANATION">Đơn giải trình điểm danh (EXPLANATION)</option>
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Thời gian bắt đầu *
              </label>
              <input
                type="datetime-local"
                required
                value={requestForm.startAt}
                onChange={(e) => setRequestForm({ ...requestForm, startAt: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Thời gian kết thúc *
              </label>
              <input
                type="datetime-local"
                required
                value={requestForm.endAt}
                onChange={(e) => setRequestForm({ ...requestForm, endAt: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Lý do chi tiết (Ít nhất 5 ký tự) *
            </label>
            <textarea
              required
              rows={4}
              placeholder="Ví dụ: Xin nghỉ phép giải quyết việc gia đình cá nhân..."
              value={requestForm.reason}
              onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })}
              className="input text-xs sm:text-sm resize-y"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setRequestModalOpen(false)} className="btn-secondary text-xs">
              Hủy
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Gửi đơn tới HR
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
