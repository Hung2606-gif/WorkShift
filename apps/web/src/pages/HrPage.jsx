import { useEffect, useState, useMemo } from 'react';
import { readSheet } from 'read-excel-file/browser';
import { 
  getHrEmployees,
  updateHrEmployee,
  getHrShifts,
  createHrShift,
  updateHrShift,
  assignHrShift,
  getHrRequests,
  reviewHrRequest,
  getHrAttendance,
  adjustHrAttendance,
  downloadAttendanceCsv,
  getSupportTickets,
  createSupportTicket,
  changeTemporaryPassword,
  getCompanyWifi,
  updateCompanyIp,
  getOffices,
  createOffice,
  updateOffice,
  deleteOffice,
  inviteEmployee,
  inviteEmployeesBulk,
  sendCompanyEmail
} from '../lib/api';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { 
  Users, 
  Clock, 
  FileText, 
  Calendar, 
  Download, 
  Building2, 
  Wifi, 
  Mail, 
  LifeBuoy, 
  RefreshCw, 
  Plus, 
  Edit3, 
  CheckCircle2, 
  AlertCircle, 
  Send, 
  Search, 
  Filter, 
  CalendarCheck, 
  UserCheck, 
  Check, 
  X, 
  Zap, 
  MapPin, 
  Globe, 
  UserPlus, 
  Briefcase, 
  Phone, 
  User,
  Lock,
  FileSpreadsheet,
  Upload
} from 'lucide-react';

// Check-ins from outside the company network are allowed; HR reviews them here.
function offNetworkNote(log) {
  const notes = [['vào', log.check_in_evidence], ['ra', log.check_out_evidence]]
    .filter(([, evidence]) => evidence?.ipMatchesCompany === false)
    .map(([label, evidence]) => `Chấm công ${label} từ IP ${evidence.ip}`);
  return notes.length ? notes.join('; ') : null;
}

const shiftDefaults = {
  name: '',
  startTime: '08:30',
  endTime: '17:30',
  lateGraceMinutes: 15,
  isOvernight: false,
  isActive: true
};

const ticketDefaults = {
  subject: '',
  description: '',
  priority: 'NORMAL'
};

const officeDefaults = {
  name: '',
  latitude: '',
  longitude: '',
  radiusMeters: 50,
  workStart: '08:30',
  workEnd: '17:30',
  lateGraceMinutes: 15,
  earlyLeaveGraceMinutes: 15,
  allowedIp: '',
  requireTrustedDevice: false
};

const employeeImportHeaders = {
  fullName: ['họ và tên', 'ho va ten', 'họ tên', 'ho ten', 'full name', 'fullname', 'name'],
  email: ['email', 'e-mail', 'email address'],
  officeId: ['mã phòng ban', 'ma phong ban', 'office id', 'officeid', 'department id'],
  officeName: ['phòng ban', 'phong ban', 'department', 'office', 'chi nhánh', 'chi nhanh', 'branch']
};

function normalizedText(value) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

function parseCsv(text) {
  const rows = [];
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

function readColumn(row, headers, aliases) {
  const index = headers.findIndex((header) => aliases.includes(header));
  return index < 0 ? '' : String(row[index] ?? '').trim();
}

function prepareEmployeeImport(rows, departments) {
  if (rows.length < 2) throw new Error('Tệp phải có dòng tiêu đề và ít nhất một nhân viên.');
  const headers = rows[0].map(normalizedText);
  if (!employeeImportHeaders.fullName.some((header) => headers.includes(header)) || !employeeImportHeaders.email.some((header) => headers.includes(header))) {
    throw new Error('Tệp cần hai cột “Họ và tên” và “Email”. Cột “Phòng ban” hoặc “Mã phòng ban” là tùy chọn.');
  }
  const departmentsByName = new Map(departments.map((department) => [normalizedText(department.name), department.id]));
  const departmentIds = new Set(departments.map((department) => department.id));
  const emails = new Set();

  return rows.slice(1).map((row, rowIndex) => {
    const fullName = readColumn(row, headers, employeeImportHeaders.fullName);
    const email = readColumn(row, headers, employeeImportHeaders.email).toLowerCase();
    const officeIdValue = readColumn(row, headers, employeeImportHeaders.officeId);
    const officeName = readColumn(row, headers, employeeImportHeaders.officeName);
    const issues = [];
    let officeId = null;

    if (fullName.length < 2 || fullName.length > 100) issues.push('Họ tên phải có từ 2 đến 100 ký tự.');
    if (!/^[^\s@]+@gmail\.com$/i.test(email)) issues.push('Email nhân viên phải thuộc @gmail.com.');
    if (email && emails.has(email)) issues.push('Email bị trùng trong tệp.');
    if (email) emails.add(email);
    if (officeIdValue) {
      if (!departmentIds.has(officeIdValue)) issues.push('Mã phòng ban không thuộc công ty.');
      else officeId = officeIdValue;
    } else if (officeName) {
      officeId = departmentsByName.get(normalizedText(officeName)) ?? null;
      if (!officeId) issues.push('Không tìm thấy phòng ban theo tên.');
    }
    return { sourceRow: rowIndex + 2, fullName, email, officeId, officeName, issues };
  }).filter((row) => row.fullName || row.email || row.officeId || row.officeName);
}

export function HrPage({ profile, onProfileChanged }) {
  const [activeTab, setActiveTab] = useState('employees');

  // Data states
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [companyWifi, setCompanyWifi] = useState(null);

  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));

  // Loading & Notice states
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState();
  const [notice, setNotice] = useState();

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('');

  // Modals
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [invitationForm, setInvitationForm] = useState({ fullName: '', email: '', officeId: '' });
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [importResult, setImportResult] = useState(null);

  const [editEmployeeModalOpen, setEditEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);

  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [shiftForm, setShiftForm] = useState(shiftDefaults);

  const [assignShiftModalOpen, setAssignShiftModalOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ userId: '', shiftId: '', workDate: new Date().toISOString().slice(0, 10) });

  const [reviewRequestModalOpen, setReviewRequestModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [reviewAction, setReviewAction] = useState({ status: 'APPROVED', reviewNote: '' });

  const [adjustAttendanceModalOpen, setAdjustAttendanceModalOpen] = useState(false);
  const [selectedAttendance, setSelectedAttendance] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ checkInTime: '', checkOutTime: '', status: 'NORMAL', adjustmentNote: '' });

  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [ticketForm, setTicketForm] = useState(ticketDefaults);

  const [officeModalOpen, setOfficeModalOpen] = useState(false);
  const [editingOfficeId, setEditingOfficeId] = useState(null);
  const [officeForm, setOfficeForm] = useState(officeDefaults);

  const [customIp, setCustomIp] = useState('');
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', text: '' });

  // Load Data
  async function loadData() {
    if (profile.is_temporary_password) return;
    setBusy(true);
    setError(undefined);
    try {
      if (activeTab === 'employees') {
        const [empRes, deptRes] = await Promise.all([getHrEmployees(), getOffices()]);
        setEmployees(empRes.data || []);
        setDepartments(deptRes.data || []);
      } else if (activeTab === 'shifts') {
        const [shiftRes, empRes] = await Promise.all([getHrShifts(), getHrEmployees()]);
        setShifts(shiftRes.data || []);
        setEmployees(empRes.data || []);
      } else if (activeTab === 'requests') {
        const reqRes = await getHrRequests();
        setRequests(reqRes.data || []);
      } else if (activeTab === 'attendance') {
        const attRes = await getHrAttendance(selectedMonth);
        setAttendanceLogs(attRes.data || []);
      } else if (activeTab === 'departments') {
        const deptRes = await getOffices();
        setDepartments(deptRes.data || []);
      } else if (activeTab === 'wifi-ip') {
        const wifiRes = await getCompanyWifi();
        setCompanyWifi(wifiRes.data ?? null);
      } else if (activeTab === 'support') {
        const tickRes = await getSupportTickets();
        setTickets(tickRes.data || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!profile.is_temporary_password) void loadData();
  }, [activeTab, selectedMonth, profile.is_temporary_password]);

  // Employee Handlers
  async function handleInviteSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await inviteEmployee({
        fullName: invitationForm.fullName.trim(),
        email: invitationForm.email.trim().toLowerCase(),
        officeId: invitationForm.officeId || null,
        role: 'EMPLOYEE'
      });
      setInviteModalOpen(false);
      setNotice('Đã gửi thư mời kích hoạt tài khoản tới nhân viên!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi lời mời.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEmployeeImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Tệp import không được lớn hơn 2 MB.');
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx'].includes(extension)) {
      setError('Chỉ hỗ trợ tệp CSV hoặc Excel (.xlsx).');
      return;
    }
    setBusy(true);
    setError(undefined);
    setImportResult(null);
    try {
      const rows = extension === 'csv' ? parseCsv(await file.text()) : await readSheet(file);
      const prepared = prepareEmployeeImport(rows, departments);
      if (!prepared.length) throw new Error('Không tìm thấy dòng nhân viên hợp lệ trong tệp.');
      if (prepared.length > 50) throw new Error('Mỗi lần chỉ import tối đa 50 nhân viên.');
      setImportFileName(file.name);
      setImportRows(prepared);
    } catch (err) {
      setImportFileName('');
      setImportRows([]);
      setError(err instanceof Error ? err.message : 'Không thể đọc tệp import.');
    } finally {
      setBusy(false);
    }
  }

  function downloadEmployeeImportTemplate() {
    const content = 'Họ và tên,Email,Phòng ban\nNguyễn Văn A,nguyenvana@gmail.com,Nhân sự\n';
    const url = window.URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mau-import-nhan-vien.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function handleBulkInviteSubmit() {
    const eligibleRows = importRows.filter((row) => row.issues.length === 0);
    if (!eligibleRows.length) {
      setError('Không có dòng hợp lệ để gửi lời mời.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await inviteEmployeesBulk(eligibleRows.map(({ fullName, email, officeId }) => ({ fullName, email, officeId, role: 'EMPLOYEE' })));
      setImportResult(response.data);
      if (response.data.succeeded) await loadData();
      setNotice(`Đã gửi ${response.data.succeeded}/${response.data.requested} lời mời nhân viên.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi lời mời hàng loạt.');
    } finally {
      setBusy(false);
    }
  }

  function openEditEmployee(emp) {
    setEditingEmployee({
      id: emp.id,
      fullName: emp.full_name || '',
      officeId: emp.office_id || '',
      jobTitle: emp.job_title || '',
      phone: emp.phone || '',
      isActive: emp.is_active ?? true
    });
    setEditEmployeeModalOpen(true);
  }

  async function handleEditEmployeeSubmit(e) {
    e.preventDefault();
    if (!editingEmployee) return;
    setBusy(true);
    try {
      await updateHrEmployee(editingEmployee.id, {
        fullName: editingEmployee.fullName.trim(),
        officeId: editingEmployee.officeId || null,
        jobTitle: editingEmployee.jobTitle?.trim() || null,
        phone: editingEmployee.phone?.trim() || null,
        isActive: editingEmployee.isActive
      });
      setEditEmployeeModalOpen(false);
      setNotice('Đã cập nhật hồ sơ nhân viên thành công!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật nhân viên.');
    } finally {
      setBusy(false);
    }
  }

  // Shift Handlers
  function openAddShift() {
    setShiftForm(shiftDefaults);
    setEditingShiftId(null);
    setShiftModalOpen(true);
  }

  function openEditShift(s) {
    setShiftForm({
      name: s.name,
      startTime: s.start_time?.slice(0, 5) || '08:30',
      endTime: s.end_time?.slice(0, 5) || '17:30',
      lateGraceMinutes: s.late_grace_minutes || 15,
      isOvernight: Boolean(s.is_overnight),
      isActive: s.is_active ?? true
    });
    setEditingShiftId(s.id);
    setShiftModalOpen(true);
  }

  async function handleShiftSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: shiftForm.name.trim(),
        startTime: shiftForm.startTime,
        endTime: shiftForm.endTime,
        lateGraceMinutes: Number(shiftForm.lateGraceMinutes),
        isOvernight: shiftForm.isOvernight,
        isActive: shiftForm.isActive
      };
      if (editingShiftId) {
        await updateHrShift(editingShiftId, payload);
        setNotice('Đã cập nhật ca làm việc thành công!');
      } else {
        await createHrShift(payload);
        setNotice('Đã tạo ca làm việc mới thành công!');
      }
      setShiftModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu ca làm việc.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignShiftSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await assignHrShift(assignForm);
      setAssignShiftModalOpen(false);
      setNotice('Đã phân công ca làm việc cho nhân viên thành công!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể phân ca.');
    } finally {
      setBusy(false);
    }
  }

  // Request Review Handlers
  function openReviewRequest(req, status) {
    setSelectedRequest(req);
    setReviewAction({
      status,
      reviewNote: status === 'APPROVED' ? 'Đã phê duyệt.' : 'Chưa phù hợp với kế hoạch ca trực.'
    });
    setReviewRequestModalOpen(true);
  }

  async function handleReviewRequestSubmit(e) {
    e.preventDefault();
    if (!selectedRequest) return;
    setBusy(true);
    try {
      await reviewHrRequest(selectedRequest.id, reviewAction);
      setReviewRequestModalOpen(false);
      setNotice(`Đã ${reviewAction.status === 'APPROVED' ? 'phê duyệt' : 'từ chối'} đơn thành công!`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xử lý đơn.');
    } finally {
      setBusy(false);
    }
  }

  // Attendance Adjustment Handlers
  function openAdjustAttendance(log) {
    setSelectedAttendance(log);
    setAdjustForm({
      checkInTime: log.check_in_time ? new Date(log.check_in_time).toISOString().slice(0, 16) : '',
      checkOutTime: log.check_out_time ? new Date(log.check_out_time).toISOString().slice(0, 16) : '',
      status: log.status || 'NORMAL',
      adjustmentNote: log.adjustment_note || 'Điều chỉnh giờ chấm công theo giải trình của nhân sự.'
    });
    setAdjustAttendanceModalOpen(true);
  }

  async function handleAdjustAttendanceSubmit(e) {
    e.preventDefault();
    if (!selectedAttendance) return;
    setBusy(true);
    try {
      const payload = {
        checkInTime: adjustForm.checkInTime ? new Date(adjustForm.checkInTime).toISOString() : undefined,
        checkOutTime: adjustForm.checkOutTime ? new Date(adjustForm.checkOutTime).toISOString() : null,
        status: adjustForm.status,
        adjustmentNote: adjustForm.adjustmentNote.trim()
      };
      await adjustHrAttendance(selectedAttendance.id, payload);
      setAdjustAttendanceModalOpen(false);
      setNotice('Đã điều chỉnh dữ liệu chấm công thành công!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể điều chỉnh chấm công.');
    } finally {
      setBusy(false);
    }
  }

  // Support Ticket Handlers
  async function handleSupportTicketSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createSupportTicket(ticketForm);
      setTicketModalOpen(false);
      setTicketForm(ticketDefaults);
      setNotice('Đã gửi ticket yêu cầu hỗ trợ tới Quản trị viên hệ thống!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi ticket.');
    } finally {
      setBusy(false);
    }
  }

  // Company Wi-Fi IP
  async function handleUpdateCompanyIp(useDetected = true) {
    setBusy(true);
    try {
      const payload = useDetected ? undefined : customIp.trim();
      const res = await updateCompanyIp(payload);
      setCompanyWifi(res.data ?? null);
      setNotice(res.message || 'Đã cập nhật địa chỉ IP Wi-Fi công ty thành công!');
      setCustomIp('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật IP.');
    } finally {
      setBusy(false);
    }
  }

  // Department Handlers
  function openAddOffice() {
    setOfficeForm(officeDefaults);
    setEditingOfficeId(null);
    setOfficeModalOpen(true);
  }

  function openEditOffice(dept) {
    setOfficeForm({
      name: dept.name || '',
      latitude: dept.latitude ?? '',
      longitude: dept.longitude ?? '',
      radiusMeters: dept.radius_meters ?? 50,
      workStart: dept.work_start?.slice(0, 5) ?? '08:30',
      workEnd: dept.work_end?.slice(0, 5) ?? '17:30',
      lateGraceMinutes: dept.late_grace_minutes ?? 15,
      earlyLeaveGraceMinutes: dept.early_leave_grace_minutes ?? 15,
      allowedIp: dept.allowed_ip ?? '',
      requireTrustedDevice: Boolean(dept.require_trusted_device)
    });
    setEditingOfficeId(dept.id);
    setOfficeModalOpen(true);
  }

  async function handleOfficeSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: officeForm.name.trim(),
        latitude: Number(officeForm.latitude),
        longitude: Number(officeForm.longitude),
        radiusMeters: Number(officeForm.radiusMeters),
        workStart: officeForm.workStart,
        workEnd: officeForm.workEnd,
        lateGraceMinutes: Number(officeForm.lateGraceMinutes),
        earlyLeaveGraceMinutes: Number(officeForm.earlyLeaveGraceMinutes),
        allowedIp: officeForm.allowedIp.trim() || null,
        requireTrustedDevice: officeForm.requireTrustedDevice
      };
      if (editingOfficeId) {
        await updateOffice(editingOfficeId, payload);
        setNotice('Đã cập nhật thông tin phòng ban thành công!');
      } else {
        await createOffice(payload);
        setNotice('Đã tạo phòng ban mới thành công!');
      }
      setOfficeModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu phòng ban.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOffice(id, name) {
    if (!window.confirm(`Xóa phòng ban "${name}"?`)) return;
    setBusy(true);
    try {
      await deleteOffice(id);
      setNotice('Đã xóa phòng ban thành công!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa phòng ban.');
    } finally {
      setBusy(false);
    }
  }

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchSearch = !searchQuery.trim() || 
        emp.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.email?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept = !filterDept || emp.office_id === filterDept;
      return matchSearch && matchDept;
    });
  }, [employees, searchQuery, filterDept]);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-700 mb-2">
            <Briefcase className="size-3.5" />
            <span>Không gian Quản lý Doanh nghiệp (HR Workspace)</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-display">
            Quản trị Nhân sự & Vận hành Doanh nghiệp
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            Quản lý hồ sơ nhân viên, thiết lập ca trực, duyệt đơn từ trực tuyến và xuất báo cáo chấm công.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'attendance' && (
            <button
              onClick={() => void downloadAttendanceCsv()}
              className="btn-primary text-xs sm:text-sm"
              title="Tải bảng chấm công định dạng CSV"
            >
              <Download className="size-4" />
              <span>Xuất CSV Báo cáo</span>
            </button>
          )}

          <button
            onClick={() => void loadData()}
            disabled={busy}
            className="btn-secondary text-xs sm:text-sm"
            title="Làm mới dữ liệu"
          >
            <RefreshCw className={`size-4 text-slate-600 ${busy ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
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

      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <div className="flex gap-2 overflow-x-auto pb-px">
          <button
            onClick={() => setActiveTab('employees')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'employees'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="size-4" />
            <span>Nhân sự ({employees.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('shifts')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'shifts'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Clock className="size-4" />
            <span>Ca làm việc ({shifts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('requests')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'requests'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="size-4" />
            <span>Duyệt Đơn từ ({requests.filter((r) => r.status === 'PENDING').length})</span>
          </button>

          <button
            onClick={() => setActiveTab('attendance')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'attendance'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Calendar className="size-4" />
            <span>Bảng Chấm công</span>
          </button>

          <button
            onClick={() => setActiveTab('departments')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'departments'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Building2 className="size-4" />
            <span>Phòng ban & Chi nhánh</span>
          </button>

          <button
            onClick={() => setActiveTab('wifi-ip')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'wifi-ip'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Wifi className="size-4" />
            <span>Cấu hình IP Wi-Fi</span>
          </button>

          <button
            onClick={() => setActiveTab('support')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'support'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <LifeBuoy className="size-4" />
            <span>Hỗ trợ Kỹ thuật ({tickets.length})</span>
          </button>
        </div>
      </div>

      {/* ===================== TAB 1: EMPLOYEES ===================== */}
      {activeTab === 'employees' && (
        <div className="space-y-4">
          <div className="card p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm theo họ tên, email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input pl-9 text-xs sm:text-sm py-2"
                />
              </div>

              <select
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                className="input text-xs sm:text-sm py-2 sm:max-w-[200px]"
              >
                <option value="">Tất cả phòng ban</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => {
                  setImportFileName('');
                  setImportRows([]);
                  setImportResult(null);
                  setImportModalOpen(true);
                }}
                className="btn-secondary text-xs sm:text-sm"
              >
                <FileSpreadsheet className="size-4" />
                <span>Import CSV/Excel</span>
              </button>
              <button
                onClick={() => {
                  setInvitationForm({ fullName: '', email: '', officeId: '' });
                  setInviteModalOpen(true);
                }}
                className="btn-primary text-xs sm:text-sm"
              >
                <UserPlus className="size-4" />
                <span>Mời nhân viên mới</span>
              </button>
            </div>
          </div>

          <div className="card p-0 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Họ tên & Email</th>
                    <th className="px-5 py-3.5">Phòng ban</th>
                    <th className="px-5 py-3.5">Chức danh / Vị trí</th>
                    <th className="px-5 py-3.5">Số điện thoại</th>
                    <th className="px-5 py-3.5">Trạng thái</th>
                    <th className="px-5 py-3.5 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="grid size-9 place-items-center rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs">
                            {emp.full_name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{emp.full_name}</p>
                            <p className="text-slate-400 text-xs">{emp.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 font-medium">
                        {emp.offices?.name || <span className="text-slate-400 italic">Chưa phân công</span>}
                      </td>
                      <td className="px-5 py-3.5 text-slate-700">
                        {emp.job_title || '-'}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {emp.phone || '-'}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={emp.is_active ? 'ACTIVE' : 'INACTIVE'} size="sm" />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => openEditEmployee(emp)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-emerald-600 transition"
                          title="Sửa hồ sơ"
                        >
                          <Edit3 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">Không tìm thấy nhân viên.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB 2: SHIFTS ===================== */}
      {activeTab === 'shifts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display">Danh mục Ca làm việc</h2>
              <p className="text-xs text-slate-500">Khung giờ quy định và thời gian ân hạn đi muộn</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setAssignShiftModalOpen(true)}
                className="btn-secondary text-xs sm:text-sm"
              >
                <CalendarCheck className="size-4 text-emerald-600" />
                <span>Phân ca theo ngày</span>
              </button>
              <button
                onClick={openAddShift}
                className="btn-primary text-xs sm:text-sm"
              >
                <Plus className="size-4" />
                <span>Thêm ca làm việc</span>
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shifts.map((s) => (
              <div key={s.id} className="card card-hover p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 font-bold">
                      <Clock className="size-5" />
                    </div>
                    <button
                      onClick={() => openEditShift(s)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 transition"
                      title="Sửa ca"
                    >
                      <Edit3 className="size-4" />
                    </button>
                  </div>

                  <h3 className="mt-3 text-base font-bold text-slate-900 font-display">{s.name}</h3>
                  <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                    <p>Khung giờ: <b className="text-emerald-700">{s.start_time?.slice(0, 5)} — {s.end_time?.slice(0, 5)}</b></p>
                    <p>Ân hạn đi muộn: <b>{s.late_grace_minutes} phút</b></p>
                    <p>Ca qua đêm: <b>{s.is_overnight ? 'Có' : 'Không'}</b></p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Trạng thái: {s.is_active ? 'Đang áp dụng' : 'Tạm dừng'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== TAB 3: REQUESTS (LEAVE / OVERTIME / EXPLANATION) ===================== */}
      {activeTab === 'requests' && (
        <div className="card p-0 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Nhân viên</th>
                  <th className="px-5 py-3.5">Loại đơn</th>
                  <th className="px-5 py-3.5">Thời gian đề xuất</th>
                  <th className="px-5 py-3.5">Lý do</th>
                  <th className="px-5 py-3.5">Trạng thái</th>
                  <th className="px-5 py-3.5 text-right">Phê duyệt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5">
                      <p className="font-bold text-slate-900">{r.users?.full_name}</p>
                      <p className="text-xs text-slate-400">{r.users?.email}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        r.request_type === 'LEAVE' ? 'bg-blue-100 text-blue-800' :
                        r.request_type === 'OVERTIME' ? 'bg-purple-100 text-purple-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {r.request_type === 'LEAVE' ? 'Nghỉ phép' : r.request_type === 'OVERTIME' ? 'Làm thêm giờ (OT)' : 'Giải trình điểm danh'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 text-xs">
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
                        {r.status === 'APPROVED' ? 'Đã duyệt' : r.status === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {r.status === 'PENDING' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openReviewRequest(r, 'APPROVED')}
                            className="rounded-lg p-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition"
                            title="Phê duyệt"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            onClick={() => openReviewRequest(r, 'REJECTED')}
                            className="rounded-lg p-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 transition"
                            title="Từ chối"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Đã xử lý</span>
                      )}
                    </td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">Chưa có đơn từ nào.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: ATTENDANCE LOGS & CSV ===================== */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <div className="card p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700 uppercase">Tháng tra cứu:</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="input py-1.5 text-xs max-w-[160px]"
              />
            </div>
            <button
              onClick={() => void downloadAttendanceCsv()}
              className="btn-secondary text-xs sm:text-sm"
            >
              <Download className="size-4 text-emerald-600" />
              <span>Tải tệp CSV</span>
            </button>
          </div>

          <div className="card p-0 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Nhân viên</th>
                    <th className="px-5 py-3.5">Giờ Check-in</th>
                    <th className="px-5 py-3.5">Giờ Check-out</th>
                    <th className="px-5 py-3.5">Trạng thái</th>
                    <th className="px-5 py-3.5">Ghi chú điều chỉnh</th>
                    <th className="px-5 py-3.5 text-right">Điều chỉnh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendanceLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-5 py-3.5">
                        <p className="font-bold text-slate-900">{log.users?.full_name}</p>
                        <p className="text-xs text-slate-400">{log.users?.email}</p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs">
                        {log.check_in_time ? new Date(log.check_in_time).toLocaleString('vi-VN') : '-'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs">
                        {log.check_out_time ? new Date(log.check_out_time).toLocaleString('vi-VN') : '-'}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={log.status} size="sm" />
                        {offNetworkNote(log) && (
                          <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-amber-700" title={offNetworkNote(log)}>
                            <AlertCircle className="size-3.5 shrink-0" />
                            IP ngoài mạng công ty
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-500">
                        {log.adjustment_note || '-'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => openAdjustAttendance(log)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 transition"
                          title="Điều chỉnh giờ"
                        >
                          <Edit3 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {attendanceLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">Không có dữ liệu chấm công trong tháng này.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB 5: DEPARTMENTS ===================== */}
      {activeTab === 'departments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display">Phòng ban & Chi nhánh</h2>
              <p className="text-xs text-slate-500">Thiết lập tọa độ văn phòng và phạm vi bán kính an toàn</p>
            </div>
            <button
              onClick={openAddOffice}
              className="btn-primary text-xs sm:text-sm"
            >
              <Plus className="size-4" />
              <span>Thêm phòng ban mới</span>
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((dept) => (
              <div key={dept.id} className="card card-hover p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 font-bold">
                      <Building2 className="size-5" />
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditOffice(dept)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 transition"
                      >
                        <Edit3 className="size-4" />
                      </button>
                      <button
                        onClick={() => void handleDeleteOffice(dept.id, dept.name)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>

                  <h3 className="mt-3 text-base font-bold text-slate-900 font-display">{dept.name}</h3>
                  <div className="mt-3 space-y-1 text-xs text-slate-600">
                    <p>Tọa độ: <b>{dept.latitude}, {dept.longitude}</b></p>
                    <p>Bán kính an toàn: <b>{dept.radius_meters}m</b></p>
                    <p>Giờ làm việc: <b>{dept.work_start?.slice(0, 5)} - {dept.work_end?.slice(0, 5)}</b></p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== TAB 6: WI-FI IP ===================== */}
      {activeTab === 'wifi-ip' && (
        <div className="max-w-2xl mx-auto space-y-6">
          <section className="card p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Wifi className="size-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 font-display">
                  Cấu hình Địa chỉ IP Wi-Fi Doanh nghiệp
                </h2>
                <p className="text-xs text-slate-500">
                  Địa chỉ IP công khai của mạng Wi-Fi doanh nghiệp. Chấm công từ IP khác vẫn được ghi nhận và được đánh dấu để HR xem lại.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">IP Wi-Fi công ty đang áp dụng</p>
                <p className="mt-2 font-mono text-xl font-bold tracking-wide text-emerald-950">
                  {companyWifi?.allowed_ip ?? 'Chưa cấu hình'}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-emerald-800/80">
                  {companyWifi?.name ? `Công ty: ${companyWifi.name}. ` : ''}IP này là địa chỉ công khai do máy chủ ghi nhận, không phải IP nội bộ 192.168.x.x.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Cách 1: Lấy tự động IP hiện tại
                </p>
                <p className="text-xs text-slate-500 mb-4">
                  Đang ngồi tại văn phòng công ty và kết nối Wi-Fi doanh nghiệp? Bấm nút dưới đây để cập nhật ngay.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleUpdateCompanyIp(true)}
                  className="btn-primary text-xs sm:text-sm"
                >
                  <Zap className="size-4" />
                  <span>Cập nhật IP Wi-Fi hiện tại của tôi</span>
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Cách 2: Nhập IP tĩnh thủ công
                </p>
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    placeholder="118.69.182.250"
                    value={customIp}
                    onChange={(e) => setCustomIp(e.target.value)}
                    className="input text-xs sm:text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy || !customIp.trim()}
                    onClick={() => void handleUpdateCompanyIp(false)}
                    className="btn-secondary shrink-0 text-xs sm:text-sm"
                  >
                    Lưu IP
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ===================== TAB 7: SUPPORT TICKETS ===================== */}
      {activeTab === 'support' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display">Trung tâm Trợ giúp Kỹ thuật</h2>
              <p className="text-xs text-slate-500">Gửi ticket hỗ trợ trực tiếp tới Quản trị viên hệ thống</p>
            </div>
            <button
              onClick={() => setTicketModalOpen(true)}
              className="btn-primary text-xs sm:text-sm"
            >
              <Plus className="size-4" />
              <span>Gửi Ticket mới</span>
            </button>
          </div>

          <div className="card p-0 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Tiêu đề & Nội dung</th>
                    <th className="px-5 py-3.5">Mức độ ưu tiên</th>
                    <th className="px-5 py-3.5">Trạng thái</th>
                    <th className="px-5 py-3.5">Phản hồi từ Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-5 py-3.5 max-w-sm">
                        <p className="font-bold text-slate-900">{t.subject}</p>
                        <p className="text-xs text-slate-500 truncate">{t.description}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          t.priority === 'URGENT' ? 'bg-rose-100 text-rose-700' :
                          t.priority === 'HIGH' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-xs">
                        {t.status}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-emerald-700 font-medium">
                        {t.admin_note || <span className="text-slate-400 italic">Đang chờ xử lý</span>}
                      </td>
                    </tr>
                  ))}
                  {tickets.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-400">Chưa có ticket nào được gửi.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: IMPORT EMPLOYEES ===================== */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import lời mời nhân viên"
        description="Tải CSV hoặc Excel (.xlsx), kiểm tra trước khi hệ thống gửi từng email kích hoạt. Tối đa 50 nhân viên/lần."
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold text-emerald-900">Tệp mẫu: Họ và tên, Email, Phòng ban (tùy chọn)</p>
                <p className="mt-1 text-[11px] leading-relaxed text-emerald-800">Email nhân viên phải là @gmail.com. Tên phòng ban phải trùng với phòng ban đã tạo trong WorkShift.</p>
              </div>
              <button type="button" onClick={downloadEmployeeImportTemplate} className="btn-secondary shrink-0 text-xs">
                <Download className="size-3.5" />
                Tải mẫu CSV
              </button>
            </div>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 p-5 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40">
            <Upload className="size-5 text-emerald-600" />
            <span className="text-xs font-bold text-slate-700">Chọn tệp CSV hoặc Excel (.xlsx)</span>
            <span className="text-[11px] text-slate-500">Dung lượng tối đa 2 MB</span>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => void handleEmployeeImportFile(event)} />
          </label>

          {importFileName && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
              Đã đọc tệp: <span className="font-semibold text-slate-900">{importFileName}</span>
            </div>
          )}

          {importRows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="font-bold text-slate-700">Xem trước {importRows.length} nhân viên</span>
                <span className={importRows.some((row) => row.issues.length) ? 'font-semibold text-amber-700' : 'font-semibold text-emerald-700'}>
                  {importRows.filter((row) => row.issues.length === 0).length} hợp lệ
                </span>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wider text-slate-500">
                    <tr><th className="px-3 py-2">Dòng</th><th className="px-3 py-2">Họ tên</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Trạng thái</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importRows.map((row) => (
                      <tr key={row.sourceRow}>
                        <td className="px-3 py-2 text-slate-500">{row.sourceRow}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{row.fullName || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{row.email || '—'}</td>
                        <td className={`px-3 py-2 ${row.issues.length ? 'text-rose-700' : 'text-emerald-700'}`}>{row.issues.length ? row.issues.join(' ') : 'Sẵn sàng gửi'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {importResult && (
            <div className={`rounded-xl border p-3 text-xs ${importResult.failed ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
              Hệ thống đã gửi {importResult.succeeded}/{importResult.requested} lời mời.
              {importResult.failed ? ` ${importResult.failed} lời mời không thể gửi; hãy kiểm tra email và thử lại.` : ''}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => setImportModalOpen(false)} className="btn-secondary text-xs">Đóng</button>
            <button type="button" disabled={busy || !importRows.some((row) => row.issues.length === 0)} onClick={() => void handleBulkInviteSubmit()} className="btn-primary text-xs">
              <UserPlus className="size-3.5" />
              Gửi lời mời hợp lệ
            </button>
          </div>
        </div>
      </Modal>

      {/* ===================== MODAL: INVITE EMPLOYEE ===================== */}
      <Modal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Mời Nhân viên Mới"
        description="Gửi email kích hoạt tài khoản WorkShift. Nhân viên sử dụng email @gmail.com."
      >
        <form onSubmit={handleInviteSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Họ và tên nhân viên *
            </label>
            <input
              type="text"
              required
              placeholder="Nguyễn Thị B"
              value={invitationForm.fullName}
              onChange={(e) => setInvitationForm({ ...invitationForm, fullName: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Email nhân viên (@gmail.com) *
            </label>
            <input
              type="email"
              required
              placeholder="thib@gmail.com"
              value={invitationForm.email}
              onChange={(e) => setInvitationForm({ ...invitationForm, email: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Phòng ban trực thuộc
            </label>
            <select
              value={invitationForm.officeId}
              onChange={(e) => setInvitationForm({ ...invitationForm, officeId: e.target.value })}
              className="input text-xs sm:text-sm"
            >
              <option value="">Chưa phân công</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setInviteModalOpen(false)} className="btn-secondary text-xs">
              Hủy
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Gửi lời mời
            </button>
          </div>
        </form>
      </Modal>

      {/* ===================== MODAL: EDIT EMPLOYEE ===================== */}
      {editingEmployee && (
        <Modal
          isOpen={editEmployeeModalOpen}
          onClose={() => setEditEmployeeModalOpen(false)}
          title="Cập nhật Hồ sơ Nhân viên"
          description="Chỉnh sửa họ tên, chức vụ, số điện thoại hoặc phòng ban."
        >
          <form onSubmit={handleEditEmployeeSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Họ và tên *
              </label>
              <input
                type="text"
                required
                value={editingEmployee.fullName}
                onChange={(e) => setEditingEmployee({ ...editingEmployee, fullName: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Chức danh / Vị trí
                </label>
                <input
                  type="text"
                  placeholder="Kỹ sư phần mềm"
                  value={editingEmployee.jobTitle}
                  onChange={(e) => setEditingEmployee({ ...editingEmployee, jobTitle: e.target.value })}
                  className="input text-xs sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Số điện thoại
                </label>
                <input
                  type="tel"
                  placeholder="0912345678"
                  value={editingEmployee.phone}
                  onChange={(e) => setEditingEmployee({ ...editingEmployee, phone: e.target.value })}
                  className="input text-xs sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Phòng ban trực thuộc
              </label>
              <select
                value={editingEmployee.officeId}
                onChange={(e) => setEditingEmployee({ ...editingEmployee, officeId: e.target.value })}
                className="input text-xs sm:text-sm"
              >
                <option value="">Chưa phân công</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="hrEmployeeActive"
                checked={editingEmployee.isActive}
                onChange={(e) => setEditingEmployee({ ...editingEmployee, isActive: e.target.checked })}
                className="size-4 text-emerald-600 rounded border-slate-300"
              />
              <label htmlFor="hrEmployeeActive" className="text-xs font-medium text-slate-700 cursor-pointer">
                Tài khoản đang hoạt động
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button type="button" onClick={() => setEditEmployeeModalOpen(false)} className="btn-secondary text-xs">
                Hủy
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                Lưu thay đổi
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================== MODAL: SHIFT ===================== */}
      <Modal
        isOpen={shiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        title={editingShiftId ? 'Chỉnh sửa Ca làm việc' : 'Thêm Ca làm việc Mới'}
        description="Quy định giờ bắt đầu, giờ kết thúc và thời gian ân hạn."
      >
        <form onSubmit={handleShiftSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Tên Ca làm việc *
            </label>
            <input
              type="text"
              required
              placeholder="Ca hành chính (08:30 - 17:30)"
              value={shiftForm.name}
              onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Giờ bắt đầu ca
              </label>
              <input
                type="time"
                required
                value={shiftForm.startTime}
                onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Giờ kết thúc ca
              </label>
              <input
                type="time"
                required
                value={shiftForm.endTime}
                onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Ân hạn đi muộn (phút)
            </label>
            <input
              type="number"
              min="0"
              max="240"
              value={shiftForm.lateGraceMinutes}
              onChange={(e) => setShiftForm({ ...shiftForm, lateGraceMinutes: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="isOvernight"
              checked={shiftForm.isOvernight}
              onChange={(e) => setShiftForm({ ...shiftForm, isOvernight: e.target.checked })}
              className="size-4 text-emerald-600 rounded border-slate-300"
            />
            <label htmlFor="isOvernight" className="text-xs font-medium text-slate-700 cursor-pointer">
              Ca làm việc qua đêm (kết thúc vào ngày hôm sau)
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setShiftModalOpen(false)} className="btn-secondary text-xs">
              Hủy
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              {editingShiftId ? 'Lưu cập nhật' : 'Tạo ca làm'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ===================== MODAL: ASSIGN SHIFT ===================== */}
      <Modal
        isOpen={assignShiftModalOpen}
        onClose={() => setAssignShiftModalOpen(false)}
        title="Phân công Ca làm việc cho Nhân viên"
        description="Gán ca làm việc cụ thể theo ngày làm việc."
      >
        <form onSubmit={handleAssignShiftSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Chọn Nhân viên *
            </label>
            <select
              required
              value={assignForm.userId}
              onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })}
              className="input text-xs sm:text-sm"
            >
              <option value="">-- Chọn nhân viên --</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name} ({e.email})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Chọn Ca làm việc *
            </label>
            <select
              required
              value={assignForm.shiftId}
              onChange={(e) => setAssignForm({ ...assignForm, shiftId: e.target.value })}
              className="input text-xs sm:text-sm"
            >
              <option value="">-- Chọn ca làm việc --</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Ngày làm việc *
            </label>
            <input
              type="date"
              required
              value={assignForm.workDate}
              onChange={(e) => setAssignForm({ ...assignForm, workDate: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setAssignShiftModalOpen(false)} className="btn-secondary text-xs">
              Hủy
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Xác nhận phân ca
            </button>
          </div>
        </form>
      </Modal>

      {/* ===================== MODAL: REVIEW REQUEST ===================== */}
      {selectedRequest && (
        <Modal
          isOpen={reviewRequestModalOpen}
          onClose={() => setReviewRequestModalOpen(false)}
          title={`Phê duyệt Đơn: ${selectedRequest.request_type}`}
          description={`Người nộp: ${selectedRequest.users?.full_name}`}
        >
          <form onSubmit={handleReviewRequestSubmit} className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-600 space-y-1">
              <p><b>Thời gian:</b> {new Date(selectedRequest.start_at).toLocaleString('vi-VN')} — {new Date(selectedRequest.end_at).toLocaleString('vi-VN')}</p>
              <p><b>Lý do:</b> {selectedRequest.reason}</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Hành động
              </label>
              <select
                value={reviewAction.status}
                onChange={(e) => setReviewAction({ ...reviewAction, status: e.target.value })}
                className="input text-xs sm:text-sm"
              >
                <option value="APPROVED">PHÊ DUYỆT (APPROVED)</option>
                <option value="REJECTED">TỪ CHỐI (REJECTED)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Ghi chú phản hồi cho nhân viên
              </label>
              <textarea
                rows={3}
                value={reviewAction.reviewNote}
                onChange={(e) => setReviewAction({ ...reviewAction, reviewNote: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button type="button" onClick={() => setReviewRequestModalOpen(false)} className="btn-secondary text-xs">
                Đóng
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                Xác nhận
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================== MODAL: ADJUST ATTENDANCE ===================== */}
      {selectedAttendance && (
        <Modal
          isOpen={adjustAttendanceModalOpen}
          onClose={() => setAdjustAttendanceModalOpen(false)}
          title="Điều chỉnh Giờ Chấm công"
          description={`Nhân viên: ${selectedAttendance.users?.full_name}`}
        >
          <form onSubmit={handleAdjustAttendanceSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Thời gian Check-in
                </label>
                <input
                  type="datetime-local"
                  value={adjustForm.checkInTime}
                  onChange={(e) => setAdjustForm({ ...adjustForm, checkInTime: e.target.value })}
                  className="input text-xs sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Thời gian Check-out
                </label>
                <input
                  type="datetime-local"
                  value={adjustForm.checkOutTime}
                  onChange={(e) => setAdjustForm({ ...adjustForm, checkOutTime: e.target.value })}
                  className="input text-xs sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Trạng thái
              </label>
              <select
                value={adjustForm.status}
                onChange={(e) => setAdjustForm({ ...adjustForm, status: e.target.value })}
                className="input text-xs sm:text-sm"
              >
                <option value="NORMAL">Bình thường (NORMAL)</option>
                <option value="LATE">Đi muộn (LATE)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Lý do điều chỉnh (Bắt buộc) *
              </label>
              <textarea
                required
                rows={3}
                placeholder="Ví dụ: Nhân viên quên bấm chấm công do đi công tác theo đơn giải trình..."
                value={adjustForm.adjustmentNote}
                onChange={(e) => setAdjustForm({ ...adjustForm, adjustmentNote: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button type="button" onClick={() => setAdjustAttendanceModalOpen(false)} className="btn-secondary text-xs">
                Hủy
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-xs">
                Lưu điều chỉnh
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================== MODAL: SUPPORT TICKET ===================== */}
      <Modal
        isOpen={ticketModalOpen}
        onClose={() => setTicketModalOpen(false)}
        title="Gửi Yêu cầu Hỗ trợ Kỹ thuật"
        description="Ticket sẽ được chuyển thẳng tới Quản trị viên hệ thống WorkShift."
      >
        <form onSubmit={handleSupportTicketSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Tiêu đề sự cố / yêu cầu *
            </label>
            <input
              type="text"
              required
              placeholder="Ví dụ: Cần hỗ trợ cấu hình dải IP Wi-Fi mới cho chi nhánh..."
              value={ticketForm.subject}
              onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Mức độ ưu tiên
            </label>
            <select
              value={ticketForm.priority}
              onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
              className="input text-xs sm:text-sm"
            >
              <option value="LOW">LOW (Thấp)</option>
              <option value="NORMAL">NORMAL (Bình thường)</option>
              <option value="HIGH">HIGH (Cao)</option>
              <option value="URGENT">URGENT (Khẩn cấp)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Mô tả chi tiết sự cố *
            </label>
            <textarea
              required
              rows={4}
              placeholder="Mô tả các bước xảy ra lỗi hoặc yêu cầu trợ giúp..."
              value={ticketForm.description}
              onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setTicketModalOpen(false)} className="btn-secondary text-xs">
              Hủy
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              Gửi Ticket
            </button>
          </div>
        </form>
      </Modal>

      {/* ===================== MODAL: DEPARTMENT ===================== */}
      <Modal
        isOpen={officeModalOpen}
        onClose={() => setOfficeModalOpen(false)}
        title={editingOfficeId ? 'Chỉnh sửa Phòng ban' : 'Thêm Phòng ban Mới'}
        description="Điền vị trí, bán kính và ca làm việc mặc định."
      >
        <form onSubmit={handleOfficeSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Tên phòng ban *
            </label>
            <input
              type="text"
              required
              placeholder="Phòng Kỹ thuật & Công nghệ"
              value={officeForm.name}
              onChange={(e) => setOfficeForm({ ...officeForm, name: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Vĩ độ (Lat) *
              </label>
              <input
                type="number"
                step="any"
                required
                value={officeForm.latitude}
                onChange={(e) => setOfficeForm({ ...officeForm, latitude: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Kinh độ (Long) *
              </label>
              <input
                type="number"
                step="any"
                required
                value={officeForm.longitude}
                onChange={(e) => setOfficeForm({ ...officeForm, longitude: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Bán kính (m)
              </label>
              <input
                type="number"
                value={officeForm.radiusMeters}
                onChange={(e) => setOfficeForm({ ...officeForm, radiusMeters: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setOfficeModalOpen(false)} className="btn-secondary text-xs">
              Hủy
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              {editingOfficeId ? 'Lưu cập nhật' : 'Tạo phòng ban'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
