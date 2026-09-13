import { useEffect, useState, useMemo } from 'react';
import { 
  getSystemDashboard,
  getSystemCompanies,
  createSystemCompany,
  updateSystemCompany,
  deleteSystemCompany,
  provisionSystemCompanyHr,
  getSystemSettings,
  saveSystemSetting,
  getSystemEmailTemplates,
  saveSystemEmailTemplate,
  getSystemIntegrations,
  saveSystemIntegration,
  getSystemAuditLogs,
  getSystemIpRules,
  createSystemIpRule,
  getSystemUsers,
  toggleUserSession,
  getSystemTickets,
  updateSystemTicket,
  startImpersonation,
  dispatchNotifications,
  getSystemSmtpStatus,
  verifySystemSmtp,
  sendSystemTestEmail
} from '../lib/api';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { 
  Building2, 
  Users, 
  Shield,
  LifeBuoy, 
  Settings, 
  ShieldCheck, 
  RefreshCw, 
  Plus, 
  Edit3, 
  Trash2,
  Send, 
  Search, 
  Globe, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  ExternalLink, 
  Calendar, 
  Database, 
  Key, 
  Sliders, 
  Radio, 
  Activity, 
  Mail, 
  Clock, 
  Check, 
  X,
  FileText,
  Flame,
  Copy,
  KeyRound,
  Eye,
  EyeOff
} from 'lucide-react';

const companyDefaults = {
  name: '',
  code: '',
  companyEmail: '',
  temporaryPassword: '',
  plan: 'STARTER',
  supportAccessEnabled: true
};

const subscriptionPlans = {
  STARTER: { employees: 20, storageMb: 2 * 1024, storageLabel: '2 GB' },
  BUSINESS: { employees: 100, storageMb: 50 * 1024, storageLabel: '50 GB' },
  ENTERPRISE: { employees: null, storageMb: 1000 * 1024, storageLabel: '1.000 GB' }
};

function employeeAllowance(maxEmployees) {
  return maxEmployees == null ? 'Không giới hạn' : `${maxEmployees} nhân viên`;
}

function storageAllowance(storageMb) {
  if (storageMb == null) return '-';
  return storageMb % 1024 === 0 ? `${new Intl.NumberFormat('vi-VN').format(storageMb / 1024)} GB` : `${storageMb} MB`;
}

function normalizePlan(plan) {
  return subscriptionPlans[plan] ? plan : 'STARTER';
}

const ipRuleDefaults = {
  cidr: '',
  action: 'ALLOW',
  description: '',
  isActive: true
};

export function AdminPage({ profile, onImpersonate }) {
  const [activeTab, setActiveTab] = useState('companies');

  // SaaS Overview & Dashboard State
  const [dashboard, setDashboard] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [systemUsers, setSystemUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [ipRules, setIpRules] = useState([]);
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [integrations, setIntegrations] = useState([]);

  // Loading & Alert state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState();
  const [notice, setNotice] = useState();

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState(null);
  const [companyForm, setCompanyForm] = useState(companyDefaults);

  // Modal displaying newly created/reset HR Credentials with Copy button
  const [createdHrModal, setCreatedHrModal] = useState({
    isOpen: false,
    email: '',
    temporaryPassword: '',
    companyName: ''
  });
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [showCreatedPassword, setShowCreatedPassword] = useState(true);

  // Quick Provision HR Modal
  const [provisionHrModal, setProvisionHrModal] = useState({
    isOpen: false,
    company: null,
    temporaryPassword: '',
    fullName: ''
  });

  // SMTP & Email Infrastructure State
  const [smtpStatus, setSmtpStatus] = useState({
    isConfigured: false,
    host: '',
    port: 587,
    secure: false,
    user: '',
    from: ''
  });
  const [smtpVerifying, setSmtpVerifying] = useState(false);
  const [smtpTestModalOpen, setSmtpTestModalOpen] = useState(false);
  const [smtpTestEmail, setSmtpTestEmail] = useState(profile?.email || '');
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);

  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketForm, setTicketForm] = useState({ status: 'RESOLVED', adminNote: '' });

  const [ipRuleModalOpen, setIpRuleModalOpen] = useState(false);
  const [ipRuleForm, setIpRuleForm] = useState(ipRuleDefaults);

  const [impersonateModalOpen, setImpersonateModalOpen] = useState(false);
  const [impersonateCompany, setImpersonateCompany] = useState(null);
  const [impersonateReason, setImpersonateReason] = useState('Hỗ trợ kỹ thuật cấu hình hệ thống theo yêu cầu của khách hàng.');

  // Load SaaS Master Data
  async function loadData() {
    setBusy(true);
    setError(undefined);
    try {
      const [dashRes, compRes, ticketsRes] = await Promise.all([
        getSystemDashboard(),
        getSystemCompanies(),
        getSystemTickets()
      ]);
      setDashboard(dashRes.data);
      setCompanies(compRes.data || []);
      setTickets(ticketsRes.data || []);

      if (activeTab === 'users') {
        const usersRes = await getSystemUsers();
        setSystemUsers(usersRes.data || []);
      } else if (activeTab === 'security') {
        const [auditRes, ipRes] = await Promise.all([getSystemAuditLogs(1, 50), getSystemIpRules()]);
        setAuditLogs(auditRes.data || []);
        setIpRules(ipRes.data || []);
      } else if (activeTab === 'config') {
        const [tplRes, intRes, smtpRes] = await Promise.all([
          getSystemEmailTemplates(),
          getSystemIntegrations(),
          getSystemSmtpStatus().catch(() => ({ data: { isConfigured: false } }))
        ]);
        setEmailTemplates(tplRes.data || []);
        setIntegrations(intRes.data || []);
        setSmtpStatus(smtpRes?.data || { isConfigured: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu quản trị.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [activeTab]);

  async function handleVerifySmtp() {
    setSmtpVerifying(true);
    setError(undefined);
    try {
      const res = await verifySystemSmtp();
      setNotice(res.data?.message || 'Kết nối máy chủ SMTP thành công!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể kết nối máy chủ SMTP.');
    } finally {
      setSmtpVerifying(false);
    }
  }

  async function handleSendTestEmail(e) {
    e.preventDefault();
    if (!smtpTestEmail.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await sendSystemTestEmail(smtpTestEmail.trim());
      setSmtpTestModalOpen(false);
      setNotice(res.data?.message || `Đã gửi email thử nghiệm thành công đến ${smtpTestEmail}!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể gửi email thử nghiệm.');
    } finally {
      setBusy(false);
    }
  }

  // Company Actions
  function openAddCompany() {
    setCompanyForm(companyDefaults);
    setEditingCompanyId(null);
    setCompanyModalOpen(true);
  }

  function generateRandomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let rand = '';
    for (let i = 0; i < 12; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
    const pass = `WS#${rand}!26`;
    setCompanyForm((prev) => ({ ...prev, temporaryPassword: pass }));
  }

  function openProvisionHr(comp) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let rand = '';
    for (let i = 0; i < 12; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
    setProvisionHrModal({
      isOpen: true,
      company: comp,
      temporaryPassword: `WS#${rand}!26`,
      fullName: `Quản trị viên ${comp.name}`
    });
  }

  async function handleProvisionHrSubmit(e) {
    e.preventDefault();
    if (!provisionHrModal.company) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await provisionSystemCompanyHr(provisionHrModal.company.id, {
        temporaryPassword: provisionHrModal.temporaryPassword,
        fullName: provisionHrModal.fullName
      });
      const generatedPwd = res.data?.temporaryPassword || provisionHrModal.temporaryPassword;
      const compName = provisionHrModal.company.name;
      const compEmail = provisionHrModal.company.company_email;
      setProvisionHrModal({ isOpen: false, company: null, temporaryPassword: '', fullName: '' });
      setCreatedHrModal({
        isOpen: true,
        email: compEmail,
        temporaryPassword: generatedPwd,
        companyName: compName
      });
      setNotice(`Đã cấp/đặt lại tài khoản HR cho doanh nghiệp "${compName}" thành công!`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cấp tài khoản HR.');
    } finally {
      setBusy(false);
    }
  }

  function openEditCompany(comp) {
    setCompanyForm({
      name: comp.name || '',
      code: comp.code || '',
      companyEmail: comp.company_email || '',
      temporaryPassword: '',
      plan: normalizePlan(comp.plan),
      supportAccessEnabled: Boolean(comp.support_access_enabled)
    });
    setEditingCompanyId(comp.id);
    setCompanyModalOpen(true);
  }

  async function handleCompanySubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const payload = {
        name: companyForm.name.trim(),
        code: companyForm.code?.trim() || undefined,
        plan: companyForm.plan,
        supportAccessEnabled: companyForm.supportAccessEnabled
      };

      if (editingCompanyId) {
        if (companyForm.temporaryPassword) {
          payload.temporaryPassword = companyForm.temporaryPassword;
        }
        const updateRes = await updateSystemCompany(editingCompanyId, payload);
        const assignedPwd = updateRes.hrAccount?.temporaryPassword || companyForm.temporaryPassword;
        if (assignedPwd) {
          setCreatedHrModal({
            isOpen: true,
            email: companyForm.companyEmail,
            temporaryPassword: assignedPwd,
            companyName: companyForm.name
          });
        }
        setNotice(companyForm.temporaryPassword ? 'Đã cập nhật cấu hình và cấp/đặt lại mật khẩu tạm thời cho HR thành công!' : 'Đã cập nhật cấu hình doanh nghiệp thành công!');
      } else {
        const result = await createSystemCompany({
          ...payload,
          companyEmail: companyForm.companyEmail.trim().toLowerCase(),
          temporaryPassword: companyForm.temporaryPassword
        });
        if (result.data?.hr_account?.role !== 'HR' || !result.data.hr_account?.is_active) {
          throw new Error('Công ty chưa được cấp tài khoản HR. Vui lòng thử lại.');
        }
        const assignedPwd = result.hrAccount?.temporaryPassword || result.data?.hr_account?.temporaryPassword || companyForm.temporaryPassword;
        if (assignedPwd) {
          setCreatedHrModal({
            isOpen: true,
            email: companyForm.companyEmail.trim().toLowerCase(),
            temporaryPassword: assignedPwd,
            companyName: companyForm.name
          });
        }
        setNotice('Đã khởi tạo doanh nghiệp và cấp quyền HR thành công. HR sẽ đổi mật khẩu tạm thời khi đăng nhập lần đầu.');
      }
      setCompanyModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu doanh nghiệp.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCompany(comp) {
    if (!window.confirm(`Xóa vĩnh viễn doanh nghiệp "${comp.name}"? Toàn bộ tài khoản HR/nhân viên và dữ liệu tenant sẽ không thể khôi phục.`)) return;
    setBusy(true);
    try {
      await deleteSystemCompany(comp.id);
      setNotice(`Đã xóa vĩnh viễn doanh nghiệp "${comp.name}".`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa doanh nghiệp.');
    } finally {
      setBusy(false);
    }
  }

  // Support Impersonation
  function openImpersonate(comp) {
    setImpersonateCompany(comp);
    setImpersonateModalOpen(true);
  }

  async function handleStartImpersonation(e) {
    e.preventDefault();
    if (!impersonateCompany) return;
    setBusy(true);
    try {
      const res = await startImpersonation(impersonateCompany.id, impersonateReason);
      setNotice(`Đã tạo phiên đăng nhập đại diện HR (Hết hạn lúc ${new Date(res.data.expires_at).toLocaleTimeString('vi-VN')}).`);
      setImpersonateModalOpen(false);
      if (onImpersonate && res.data?.accessToken) {
        onImpersonate(res.data.accessToken);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tạo phiên đại diện.');
    } finally {
      setBusy(false);
    }
  }

  // User session toggle
  async function handleToggleUserSession(user) {
    const nextState = !user.is_active;
    if (!window.confirm(`${nextState ? 'Mở khóa' : 'Khóa'} tài khoản của "${user.full_name}"?`)) return;
    setBusy(true);
    try {
      await toggleUserSession(user.id, nextState);
      setNotice(`Đã ${nextState ? 'mở khóa' : 'khóa'} tài khoản thành công!`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật phiên tài khoản.');
    } finally {
      setBusy(false);
    }
  }

  // Ticket processing
  function openProcessTicket(ticket) {
    setSelectedTicket(ticket);
    setTicketForm({
      status: ticket.status === 'RESOLVED' ? 'CLOSED' : 'RESOLVED',
      adminNote: ticket.admin_note || 'Đã xử lý và khắc phục hoàn tất.'
    });
    setTicketModalOpen(true);
  }

  async function handleTicketSubmit(e) {
    e.preventDefault();
    if (!selectedTicket) return;
    setBusy(true);
    try {
      await updateSystemTicket(selectedTicket.id, {
        status: ticketForm.status,
        adminNote: ticketForm.adminNote.trim()
      });
      setTicketModalOpen(false);
      setNotice('Đã cập nhật trạng thái hỗ trợ thành công!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật ticket.');
    } finally {
      setBusy(false);
    }
  }

  // IP Rule creation
  async function handleIpRuleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createSystemIpRule(ipRuleForm);
      setIpRuleModalOpen(false);
      setNotice('Đã tạo quy tắc tường lửa IP toàn cục thành công!');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tạo quy tắc IP.');
    } finally {
      setBusy(false);
    }
  }

  // SMTP Dispatch
  async function handleDispatchQueue() {
    setBusy(true);
    try {
      const res = await dispatchNotifications(50);
      setNotice(`Đã gửi ${res.data?.sent || 0} thông báo qua SMTP, lỗi: ${res.data?.failed || 0}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể kích hoạt hàng đợi SMTP.');
    } finally {
      setBusy(false);
    }
  }

  // Filtered companies
  const filteredCompanies = useMemo(() => {
    return companies.filter((c) => {
      return !searchQuery.trim() || 
        c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.code?.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [companies, searchQuery]);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-xs font-bold text-indigo-700 mb-2">
            <Shield className="size-3.5" />
            <span>Trung tâm Điều hành Toàn quyền (SaaS Master Admin)</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-display">
            Quản trị Hệ thống WorkShift
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            Quản trị đa doanh nghiệp (Multi-tenant), kiểm soát tài khoản, xử lý ticket và tường lửa an ninh.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleDispatchQueue()}
            disabled={busy}
            className="btn-secondary text-xs sm:text-sm"
            title="Kích hoạt hàng đợi SMTP"
          >
            <Send className="size-4 text-indigo-600" />
            <span>Gửi hàng đợi SMTP</span>
          </button>

          <button
            onClick={() => void loadData()}
            disabled={busy}
            className="btn-secondary text-xs sm:text-sm"
            title="Tải lại toàn bộ dữ liệu"
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

      {/* SaaS Live Dashboard Metrics */}
      {dashboard && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-5 border-l-4 border-l-indigo-600">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Doanh nghiệp (Tenants)</span>
              <Building2 className="size-4 text-indigo-600" />
            </div>
            <p className="mt-3 text-3xl font-extrabold text-slate-900 font-display">
              {dashboard.companies}
            </p>
            <span className="text-[11px] text-emerald-600 font-semibold">{dashboard.activeCompanies} đang hoạt động</span>
          </div>

          <div className="card p-5 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Người dùng Hoạt động</span>
              <Users className="size-4 text-emerald-600" />
            </div>
            <p className="mt-3 text-3xl font-extrabold text-emerald-600 font-display">
              {dashboard.activeUsers}
            </p>
            <span className="text-[11px] text-slate-400">Toàn bộ hệ thống</span>
          </div>

          <div className="card p-5 border-l-4 border-l-blue-500">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Yêu cầu API Hôm nay</span>
              <Activity className="size-4 text-blue-600" />
            </div>
            <p className="mt-3 text-3xl font-extrabold text-blue-600 font-display">
              {dashboard.apiRequestsToday}
            </p>
            <span className="text-[11px] text-slate-400">Lượt truy vấn</span>
          </div>

          <div className="card p-5 border-l-4 border-l-amber-500">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-bold uppercase tracking-wider">Tickets Hỗ trợ</span>
              <LifeBuoy className="size-4 text-amber-600" />
            </div>
            <p className="mt-3 text-3xl font-extrabold text-amber-600 font-display">
              {dashboard.openTickets}
            </p>
            <span className="text-[11px] text-amber-600 font-semibold">Cần giải quyết</span>
          </div>

        </section>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <div className="flex gap-2 overflow-x-auto pb-px">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Building2 className="size-4" />
            <span>Doanh nghiệp ({companies.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'users'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="size-4" />
            <span>Người dùng Hệ thống</span>
          </button>

          <button
            onClick={() => setActiveTab('tickets')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'tickets'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <LifeBuoy className="size-4" />
            <span>Hỗ trợ Kỹ thuật {tickets.length > 0 && `(${tickets.length})`}</span>
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'security'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="size-4" />
            <span>Tường lửa & Nhật ký Audit</span>
          </button>

          <button
            onClick={() => setActiveTab('config')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
              activeTab === 'config'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Settings className="size-4" />
            <span>Cấu hình & Tích hợp</span>
          </button>
        </div>
      </div>

      {/* ===================== TAB 1: COMPANIES (TENANTS) ===================== */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="card p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm kiếm công ty theo tên hoặc mã code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-9 text-xs sm:text-sm py-2 max-w-md"
              />
            </div>

            <button
              onClick={openAddCompany}
              className="btn-primary shrink-0 text-xs sm:text-sm"
            >
              <Plus className="size-4" />
              <span>Khởi tạo Doanh nghiệp Mới</span>
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCompanies.map((comp) => {
              const plan = normalizePlan(comp.plan);
              const allowance = subscriptionPlans[plan];
              const hasHrAccount = comp.hr_account?.role === 'HR' && Boolean(comp.hr_account?.is_active);
              return (
              <div key={comp.id} className="card card-hover flex flex-col justify-between p-5">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid size-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 font-bold text-lg">
                      {comp.name?.charAt(0).toUpperCase() || 'C'}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditCompany(comp)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition"
                        title="Chỉnh sửa cấu hình"
                      >
                        <Edit3 className="size-4" />
                      </button>
                      <button
                        onClick={() => void handleDeleteCompany(comp)}
                        disabled={busy}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Xóa vĩnh viễn công ty"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900 font-display">{comp.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        plan === 'ENTERPRISE' ? 'bg-purple-100 text-purple-700' :
                        plan === 'BUSINESS' ? 'bg-blue-100 text-blue-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>
                        {plan}
                      </span>
                    </div>
                    {comp.code && <p className="text-xs text-slate-400 font-mono mt-0.5">Mã: {comp.code}</p>}
                    {comp.company_email && <p className="mt-1 text-xs text-slate-500">HR: <span className="font-semibold text-slate-700">{comp.company_email}</span></p>}
                    
                    {hasHrAccount && comp.hr_account?.is_temporary_password && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                        <span>🔑 Tài khoản HR: Đã cấp (Mật khẩu tạm thời)</span>
                      </div>
                    )}
                    {hasHrAccount && !comp.hr_account?.is_temporary_password && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                        <span>✓ Tài khoản HR: Đang hoạt động</span>
                      </div>
                    )}
                    {!hasHrAccount && (
                      <div className="mt-2.5 rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-900 flex items-center justify-between gap-2">
                        <span className="font-semibold text-amber-800">⚠️ Chưa có tài khoản HR</span>
                        <button
                          type="button"
                          onClick={() => openProvisionHr(comp)}
                          className="btn-primary py-1 px-2.5 text-[11px] cursor-pointer"
                        >
                          Cấp tài khoản HR
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 space-y-1.5 text-xs text-slate-600">
                    <p>Giới hạn nhân sự: <b>{employeeAllowance(allowance.employees)}</b></p>
                    <p>Dung lượng lưu trữ: <b>{storageAllowance(allowance.storageMb)}</b></p>
                    {comp.allowed_ip && (
                      <p className="text-emerald-700 font-mono text-[11px]">IP Wi-Fi: {comp.allowed_ip}</p>
                    )}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openProvisionHr(comp)}
                    className="text-xs font-bold text-brand-600 hover:text-brand-700 hover:bg-brand-50 rounded-lg px-2 py-1 transition flex items-center gap-1.5"
                    title="Cấp mới hoặc đặt lại mật khẩu tạm thời cho HR"
                  >
                    <Key className="size-3.5" />
                    <span>{hasHrAccount ? 'Đặt lại MK HR' : 'Cấp tài khoản HR'}</span>
                  </button>

                  <button
                    onClick={() => openImpersonate(comp)}
                    className="text-xs font-semibold text-slate-500 hover:text-indigo-600 flex items-center gap-1"
                  >
                    <Zap className="size-3.5" />
                    Truy cập đại diện
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================== TAB 2: SYSTEM USERS ===================== */}
      {activeTab === 'users' && (
        <div className="card p-0 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Họ tên & Email</th>
                  <th className="px-5 py-3.5">Doanh nghiệp</th>
                  <th className="px-5 py-3.5">Vai trò</th>
                  <th className="px-5 py-3.5">Trạng thái</th>
                  <th className="px-5 py-3.5 text-right">Khóa / Mở phiên</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {systemUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5">
                      <p className="font-bold text-slate-900">{u.full_name}</p>
                      <p className="text-xs text-slate-400">{u.email}</p>
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 font-medium">
                      {u.companies?.name || <span className="text-slate-400 italic">Hệ thống</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        u.role === 'ADMIN' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                        u.role === 'HR' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} size="sm" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => void handleToggleUserSession(u)}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                          u.is_active 
                            ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' 
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        {u.is_active ? 'Khóa tài khoản' : 'Mở khóa'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 3: TICKETS ===================== */}
      {activeTab === 'tickets' && (
        <div className="card p-0 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Doanh nghiệp</th>
                  <th className="px-5 py-3.5">Tiêu đề & Nội dung</th>
                  <th className="px-5 py-3.5">Mức độ</th>
                  <th className="px-5 py-3.5">Trạng thái</th>
                  <th className="px-5 py-3.5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5 font-bold text-slate-900">
                      {t.companies?.name}
                    </td>
                    <td className="px-5 py-3.5 max-w-sm">
                      <p className="font-bold text-slate-900">{t.subject}</p>
                      <p className="text-xs text-slate-500 truncate">{t.description}</p>
                      {t.admin_note && <p className="text-[11px] text-emerald-700 mt-1">Ghi chú: {t.admin_note}</p>}
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
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => openProcessTicket(t)}
                        className="btn-primary text-xs py-1.5 px-3"
                      >
                        Xử lý Ticket
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 5: SECURITY & FIREWALL ===================== */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* IP Firewall Rules */}
          <section className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-display">Quy tắc Tường lửa IP Toàn cục (Global CIDR)</h3>
                <p className="text-xs text-slate-500">Chặn hoặc cho phép các dải địa chỉ IP truy cập hệ thống WorkShift API</p>
              </div>
              <button
                onClick={() => {
                  setIpRuleForm(ipRuleDefaults);
                  setIpRuleModalOpen(true);
                }}
                className="btn-primary text-xs"
              >
                <Plus className="size-4" />
                Thêm dải IP
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b">
                  <tr>
                    <th className="p-3">Dải CIDR</th>
                    <th className="p-3">Hành động</th>
                    <th className="p-3">Mô tả</th>
                    <th className="p-3">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ipRules.map((rule) => (
                    <tr key={rule.id}>
                      <td className="p-3 font-mono font-bold">{rule.cidr}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${rule.action === 'ALLOW' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                          {rule.action}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{rule.description || '-'}</td>
                      <td className="p-3">{rule.is_active ? 'Đang bật' : 'Tắt'}</td>
                    </tr>
                  ))}
                  {ipRules.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-slate-400">Chưa có quy tắc CIDR toàn cục nào.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Audit Logs */}
          <section className="card p-5">
            <h3 className="text-base font-bold text-slate-900 font-display mb-1">Nhật ký Kiểm toán Hệ thống (Audit Logs)</h3>
            <p className="text-xs text-slate-500 mb-4">Ghi lại toàn bộ hành động bảo mật, cập nhật quyền và thay đổi cấu hình</p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b">
                  <tr>
                    <th className="p-3">Thời gian</th>
                    <th className="p-3">Người thực hiện</th>
                    <th className="p-3">Hành động</th>
                    <th className="p-3">Địa chỉ IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="p-3 text-slate-500">{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                      <td className="p-3 font-semibold">{log.users?.full_name || log.users?.email || 'System'}</td>
                      <td className="p-3 font-mono font-semibold text-indigo-700">{log.action}</td>
                      <td className="p-3 font-mono text-slate-500">{log.ip_address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ===================== TAB 6: CONFIG & TEMPLATES ===================== */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* Section 1: SMTP Outbound Mailer */}
          <section className="card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 font-display">Hạ tầng Gửi Email qua SMTP (Outbound)</h3>
                  {smtpStatus.isConfigured ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                      <CheckCircle2 className="size-3 text-emerald-600" />
                      Đã cấu hình
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                      <AlertCircle className="size-3 text-amber-600" />
                      Chưa cấu hình
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Dùng để gửi thông báo chấm công, bàn giao tài khoản HR, và thông báo hỗ trợ cho người dùng.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleVerifySmtp}
                  disabled={smtpVerifying}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                  title="Kiểm tra bắt tay kết nối SMTP"
                >
                  <RefreshCw className={`size-3.5 ${smtpVerifying ? 'animate-spin text-indigo-600' : 'text-slate-600'}`} />
                  <span>{smtpVerifying ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSmtpTestModalOpen(true)}
                  className="btn-primary text-xs flex items-center gap-1.5"
                >
                  <Send className="size-3.5" />
                  <span>Gửi Email Test</span>
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <p className="text-[11px] font-bold uppercase text-slate-500">SMTP Host</p>
                <p className="text-xs sm:text-sm font-mono font-bold text-slate-800 mt-1">
                  {smtpStatus.host || 'Chưa thiết lập'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <p className="text-[11px] font-bold uppercase text-slate-500">Cổng (Port) & Bảo mật</p>
                <p className="text-xs sm:text-sm font-mono font-bold text-slate-800 mt-1">
                  {smtpStatus.port || 587} {smtpStatus.secure ? '(SSL/TLS)' : '(STARTTLS)'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <p className="text-[11px] font-bold uppercase text-slate-500">Tài khoản (User)</p>
                <p className="text-xs sm:text-sm font-mono font-bold text-slate-800 mt-1 truncate">
                  {smtpStatus.user || 'Chưa thiết lập'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <p className="text-[11px] font-bold uppercase text-slate-500">Địa chỉ Gửi (FROM)</p>
                <p className="text-xs sm:text-sm font-mono font-bold text-slate-800 mt-1 truncate">
                  {smtpStatus.from || 'Chưa thiết lập'}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-3.5 text-xs text-indigo-950">
              <p className="font-bold flex items-center gap-1.5 text-indigo-900">
                <Mail className="size-4 text-indigo-600" />
                Hướng dẫn cấu hình biến môi trường SMTP trong tệp <code>apps/api/.env</code>:
              </p>
              <pre className="mt-2 p-2.5 rounded-lg bg-white/80 border border-indigo-200/60 font-mono text-[11px] text-slate-800 overflow-x-auto">
{`SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="WorkShift" <your-email@gmail.com>`}
              </pre>
            </div>
          </section>

          {/* Section 2: Inbound Email Webhook (Receiving Emails) */}
          <section className="card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 font-display">Hạ tầng Tiếp nhận Email (Inbound Email Webhook)</h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                    <Zap className="size-3 text-indigo-600" />
                    Tự động phân luồng Ticket
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Nhận email từ khách hàng / nhân viên, tự động tạo Ticket hỗ trợ mới hoặc ghi nhận phản hồi vào Ticket hiện có.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-1">
                  Webhook URL Tiếp nhận Email (Inbound Parse Endpoint)
                </label>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-white border border-slate-200 px-3.5 py-2.5">
                  <span className="font-mono text-xs sm:text-sm font-semibold text-indigo-700 select-all truncate">
                    {window.location.origin.replace(':5173', ':3001')}/api/v1/email/inbound
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin.replace(':5173', ':3001')}/api/v1/email/inbound`;
                      navigator.clipboard.writeText(url);
                      setCopiedWebhookUrl(true);
                      setTimeout(() => setCopiedWebhookUrl(false), 3000);
                    }}
                    className="shrink-0 flex items-center gap-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1 text-xs font-bold transition"
                  >
                    {copiedWebhookUrl ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    <span>{copiedWebhookUrl ? 'Đã copy!' : 'Sao chép Webhook URL'}</span>
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 text-xs text-slate-600 pt-1">
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <p className="font-bold text-slate-800">1. Tương thích Đa nền tảng</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Hỗ trợ SendGrid Inbound Parse, Resend Inbound, Mailgun, Postmark và Cloudflare Email Routing.</p>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <p className="font-bold text-slate-800">2. Gắn kết Doanh nghiệp</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Tự động nhận diện công ty và nhân sự theo địa chỉ email người gửi (FROM).</p>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <p className="font-bold text-slate-800">3. Phản hồi Tự động</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Tự động gửi email xác nhận đã tiếp nhận yêu cầu với mã Ticket tương ứng.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Email Templates */}
          <section className="card p-5">
            <h3 className="text-base font-bold text-slate-900 font-display mb-1">Mẫu Email Thông báo Hệ thống</h3>
            <p className="text-xs text-slate-500 mb-4">Các mẫu email gửi tự động cho nhân viên và HR</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {emailTemplates.map((tpl) => (
                <div key={tpl.id} className="rounded-xl border p-4 bg-slate-50">
                  <p className="font-bold text-xs text-indigo-700 font-mono">{tpl.template_key}</p>
                  <p className="font-bold text-sm text-slate-900 mt-1">{tpl.subject}</p>
                  <p className="text-xs text-slate-500 mt-1 truncate">{tpl.body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ===================== MODAL: COMPANY ===================== */}
      <Modal
        isOpen={companyModalOpen}
        onClose={() => setCompanyModalOpen(false)}
        title={editingCompanyId ? 'Chỉnh sửa Cấu hình Doanh nghiệp' : 'Khởi tạo Doanh nghiệp Mới (Tenant)'}
        description="Thiết lập gói dịch vụ, hạn mức nhân sự và dung lượng lưu trữ."
      >
        <form onSubmit={handleCompanySubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Tên Doanh nghiệp / Công ty *
            </label>
            <input
              type="text"
              required
              placeholder="Tập đoàn Công nghệ ABC"
              value={companyForm.name}
              onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
              className="input text-xs sm:text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Email doanh nghiệp / HR {!editingCompanyId && '*'}
              </label>
              <input
                type="email"
                required={!editingCompanyId}
                disabled={Boolean(editingCompanyId)}
                autoComplete="email"
                placeholder="hr@company.com"
                value={companyForm.companyEmail}
                onChange={(e) => setCompanyForm({ ...companyForm, companyEmail: e.target.value })}
                className="input text-xs sm:text-sm disabled:bg-slate-100 disabled:text-slate-500"
              />
              <p className="mt-1 text-[11px] text-slate-500">Tài khoản HR phải dùng tên miền @company.com.</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  {editingCompanyId ? 'Đặt lại Mật khẩu tạm thời (tùy chọn)' : 'Mật khẩu tạm thời (tùy chọn)'}
                </label>
                <button
                  type="button"
                  onClick={generateRandomPassword}
                  className="text-[11px] font-bold text-brand-600 hover:text-brand-700 underline cursor-pointer"
                >
                  Tạo ngẫu nhiên
                </button>
              </div>
              <input
                type="text"
                autoComplete="new-password"
                placeholder="Tự động tạo mật khẩu an toàn nếu để trống"
                value={companyForm.temporaryPassword}
                onChange={(e) => setCompanyForm({ ...companyForm, temporaryPassword: e.target.value })}
                className="input font-mono text-xs sm:text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {editingCompanyId 
                  ? 'Để trống nếu không muốn thay đổi mật khẩu HR hiện tại.' 
                  : 'Để trống để hệ thống tự tạo mật khẩu mạnh ≥16 ký tự theo chuẩn bảo mật hệ thống.'}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Mã định danh (Code)
              </label>
              <input
                type="text"
                placeholder="abc-corp"
                value={companyForm.code}
                onChange={(e) => setCompanyForm({ ...companyForm, code: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Gói Dịch vụ (Plan)
              </label>
              <select
                value={companyForm.plan}
                onChange={(e) => setCompanyForm({ ...companyForm, plan: e.target.value })}
                className="input text-xs sm:text-sm"
              >
                <option value="STARTER">STARTER — 20 nhân viên, 2 GB</option>
                <option value="BUSINESS">BUSINESS — 100 nhân viên, 50 GB</option>
                <option value="ENTERPRISE">ENTERPRISE — Không giới hạn, 1.000 GB</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-xs text-indigo-950">
            <p className="font-bold">Hạn mức được áp dụng tự động theo gói</p>
            <p className="mt-1 text-indigo-800">
              {employeeAllowance(subscriptionPlans[companyForm.plan].employees)} · {subscriptionPlans[companyForm.plan].storageLabel} lưu trữ cloud
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="supportAccess"
              checked={companyForm.supportAccessEnabled}
              onChange={(e) => setCompanyForm({ ...companyForm, supportAccessEnabled: e.target.checked })}
              className="size-4 text-indigo-600 rounded border-slate-300"
            />
            <label htmlFor="supportAccess" className="text-xs font-medium text-slate-700 cursor-pointer">
              Cho phép Admin truy cập đại diện khi công ty yêu cầu hỗ trợ (Support Impersonation)
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setCompanyModalOpen(false)}
              className="btn-secondary text-xs"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary text-xs"
            >
              {editingCompanyId ? 'Lưu cập nhật' : 'Khởi tạo Doanh nghiệp'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ===================== MODAL: QUICK PROVISION HR ===================== */}
      {provisionHrModal.company && (
        <Modal
          isOpen={provisionHrModal.isOpen}
          onClose={() => setProvisionHrModal({ isOpen: false, company: null, temporaryPassword: '', fullName: '' })}
          title={`Cấp / Đặt lại Mật khẩu HR — ${provisionHrModal.company.name}`}
          description="Thiết lập mật khẩu tạm thời cho tài khoản HR doanh nghiệp để đăng nhập lần đầu."
        >
          <form onSubmit={handleProvisionHrSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Email tài khoản HR
              </label>
              <input
                type="text"
                disabled
                value={provisionHrModal.company.company_email}
                className="input text-xs sm:text-sm bg-slate-100 text-slate-600 font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Họ và tên Quản trị viên HR
              </label>
              <input
                type="text"
                placeholder="VD: Quản trị viên HR"
                value={provisionHrModal.fullName}
                onChange={(e) => setProvisionHrModal({ ...provisionHrModal, fullName: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Mật khẩu tạm thời
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
                    let rand = '';
                    for (let i = 0; i < 12; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
                    setProvisionHrModal((prev) => ({ ...prev, temporaryPassword: `WS#${rand}!26` }));
                  }}
                  className="text-[11px] font-bold text-brand-600 hover:text-brand-700 underline cursor-pointer"
                >
                  Tạo mật khẩu ngẫu nhiên
                </button>
              </div>
              <input
                type="text"
                autoComplete="new-password"
                placeholder="Tự động tạo mật khẩu mạnh nếu để trống"
                value={provisionHrModal.temporaryPassword}
                onChange={(e) => setProvisionHrModal({ ...provisionHrModal, temporaryPassword: e.target.value })}
                className="input font-mono text-xs sm:text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Để trống để hệ thống tự tạo mật khẩu chuẩn bảo mật cao (16+ ký tự).
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setProvisionHrModal({ isOpen: false, company: null, temporaryPassword: '', fullName: '' })}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={busy}
                className="btn-primary text-xs"
              >
                Xác nhận Cấp Mật khẩu HR
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================== MODAL: CREATED HR CREDENTIALS & COPY ===================== */}
      {createdHrModal.isOpen && (
        <Modal
          isOpen={createdHrModal.isOpen}
          onClose={() => {
            setCreatedHrModal({ isOpen: false, email: '', temporaryPassword: '', companyName: '' });
            setCopiedPassword(false);
          }}
          title="Thông tin Tài khoản Quản trị HR"
          description="Tài khoản HR đã được khởi tạo/cấp mật khẩu tạm thời thành công."
        >
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-emerald-900 flex items-start gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600 mt-0.5" />
              <div className="text-xs sm:text-sm">
                <p className="font-bold text-emerald-950">Đã cấp tài khoản HR thành công!</p>
                <p className="mt-1 text-emerald-800">
                  Vui lòng lưu lại mật khẩu này và bàn giao cho người quản lý của <b>{createdHrModal.companyName}</b>. HR sẽ được yêu cầu đổi mật khẩu mới trong lần đăng nhập đầu tiên.
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-1">
                  Email đăng nhập HR
                </label>
                <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-3.5 py-2.5">
                  <span className="font-mono text-xs sm:text-sm font-semibold text-slate-800 select-all">
                    {createdHrModal.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(createdHrModal.email);
                    }}
                    className="text-slate-400 hover:text-brand-600 p-1"
                    title="Sao chép Email"
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                    Mật khẩu tạm thời
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCreatedPassword(!showCreatedPassword)}
                    className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1"
                  >
                    {showCreatedPassword ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    <span>{showCreatedPassword ? 'Ẩn' : 'Hiện'}</span>
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-3.5 py-2.5">
                  <span className="font-mono text-xs sm:text-sm font-bold text-indigo-600 select-all">
                    {showCreatedPassword ? createdHrModal.temporaryPassword : '••••••••••••••••'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(createdHrModal.temporaryPassword);
                      setCopiedPassword(true);
                      setTimeout(() => setCopiedPassword(false), 3000);
                    }}
                    className="flex items-center gap-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1 text-xs font-bold transition"
                  >
                    {copiedPassword ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    <span>{copiedPassword ? 'Đã sao chép!' : 'Copy mật khẩu'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  const fullText = `Thông tin đăng nhập WorkShift HR:\n- Công ty: ${createdHrModal.companyName}\n- Email: ${createdHrModal.email}\n- Mật khẩu tạm thời: ${createdHrModal.temporaryPassword}\n- Link đăng nhập: ${window.location.origin}/login`;
                  navigator.clipboard.writeText(fullText);
                  setCopiedPassword(true);
                  setTimeout(() => setCopiedPassword(false), 3000);
                }}
                className="btn-secondary text-xs flex items-center gap-1.5"
              >
                <Copy className="size-3.5" />
                <span>Sao chép toàn bộ thông tin</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatedHrModal({ isOpen: false, email: '', temporaryPassword: '', companyName: '' });
                  setCopiedPassword(false);
                }}
                className="btn-primary text-xs"
              >
                Đã hiểu & Hoàn tất
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ===================== MODAL: IMPERSONATION ===================== */}
      {impersonateCompany && (
        <Modal
          isOpen={impersonateModalOpen}
          onClose={() => setImpersonateModalOpen(false)}
          title={`Truy cập Đại diện — ${impersonateCompany.name}`}
          description="Tạo phiên đăng nhập hỗ trợ tạm thời trong 15 phút với tư cách HR công ty."
        >
          <form onSubmit={handleStartImpersonation} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Lý do truy cập hỗ trợ (Bắt buộc ghi nhận vào Audit Log) *
              </label>
              <textarea
                required
                rows={3}
                value={impersonateReason}
                onChange={(e) => setImpersonateReason(e.target.value)}
                className="input text-xs sm:text-sm resize-y"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setImpersonateModalOpen(false)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={busy}
                className="btn-primary text-xs"
              >
                Bắt đầu phiên đại diện
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================== MODAL: TICKET RESOLUTION ===================== */}
      {selectedTicket && (
        <Modal
          isOpen={ticketModalOpen}
          onClose={() => setTicketModalOpen(false)}
          title="Xử lý Ticket Yêu cầu Hỗ trợ"
          description={`Công ty: ${selectedTicket.companies?.name} | Tiêu đề: ${selectedTicket.subject}`}
        >
          <form onSubmit={handleTicketSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Trạng thái Ticket
              </label>
              <select
                value={ticketForm.status}
                onChange={(e) => setTicketForm({ ...ticketForm, status: e.target.value })}
                className="input text-xs sm:text-sm"
              >
                <option value="IN_PROGRESS">Đang xử lý (IN_PROGRESS)</option>
                <option value="RESOLVED">Đã giải quyết (RESOLVED)</option>
                <option value="CLOSED">Đã đóng (CLOSED)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Ghi chú phản hồi của Quản trị viên
              </label>
              <textarea
                required
                rows={4}
                value={ticketForm.adminNote}
                onChange={(e) => setTicketForm({ ...ticketForm, adminNote: e.target.value })}
                className="input text-xs sm:text-sm resize-y"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTicketModalOpen(false)}
                className="btn-secondary text-xs"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={busy}
                className="btn-primary text-xs"
              >
                Lưu kết quả xử lý
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================== MODAL: IP FIREWALL RULE ===================== */}
      {ipRuleModalOpen && (
        <Modal
          isOpen={ipRuleModalOpen}
          onClose={() => setIpRuleModalOpen(false)}
          title="Thêm Quy tắc Tường lửa IP Toàn cục"
          description="Thiết lập địa chỉ CIDR cho phép hoặc chặn truy cập toàn hệ thống."
        >
          <form onSubmit={handleIpRuleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Địa chỉ CIDR (IPv4 / IPv6) *
              </label>
              <input
                type="text"
                required
                placeholder="118.69.0.0/16 hoặc 2001:db8::/32"
                value={ipRuleForm.cidr}
                onChange={(e) => setIpRuleForm({ ...ipRuleForm, cidr: e.target.value })}
                className="input text-xs sm:text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Hành động (Action)
              </label>
              <select
                value={ipRuleForm.action}
                onChange={(e) => setIpRuleForm({ ...ipRuleForm, action: e.target.value })}
                className="input text-xs sm:text-sm"
              >
                <option value="ALLOW">ALLOW (Cho phép)</option>
                <option value="DENY">DENY (Chặn truy cập)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Mô tả ghi chú
              </label>
              <input
                type="text"
                placeholder="Dải IP VPN văn phòng tổng công ty"
                value={ipRuleForm.description}
                onChange={(e) => setIpRuleForm({ ...ipRuleForm, description: e.target.value })}
                className="input text-xs sm:text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIpRuleModalOpen(false)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={busy}
                className="btn-primary text-xs"
              >
                Lưu quy tắc IP
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ===================== MODAL: SEND TEST SMTP EMAIL ===================== */}
      {smtpTestModalOpen && (
        <Modal
          isOpen={smtpTestModalOpen}
          onClose={() => setSmtpTestModalOpen(false)}
          title="Gửi Email Thử nghiệm qua SMTP"
          description="Hệ thống sẽ gửi 1 email kiểm tra từ máy chủ SMTP để xác minh hoạt động."
        >
          <form onSubmit={handleSendTestEmail} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Địa chỉ Email người nhận *
              </label>
              <input
                type="email"
                required
                placeholder="ten-ban@gmail.com"
                value={smtpTestEmail}
                onChange={(e) => setSmtpTestEmail(e.target.value)}
                className="input text-xs sm:text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Nhập địa chỉ email cá nhân hoặc công ty của bạn để kiểm tra hộp thư đến.
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-600 space-y-1">
              <p className="font-bold text-slate-800">Thông số máy chủ đang dùng:</p>
              <p>Host: <span className="font-mono font-semibold">{smtpStatus.host || 'Chưa thiết lập'}</span> (Port: {smtpStatus.port || 587})</p>
              <p>Người gửi (FROM): <span className="font-mono font-semibold">{smtpStatus.from || 'Chưa thiết lập'}</span></p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSmtpTestModalOpen(false)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={busy}
                className="btn-primary text-xs flex items-center gap-1.5"
              >
                <Send className="size-3.5" />
                <span>{busy ? 'Đang gửi...' : 'Gửi Email Ngay'}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
