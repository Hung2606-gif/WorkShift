const baseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3001/api/v1';

let tokenProvider;

export function setTokenProvider(provider) {
  tokenProvider = provider;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, init = {}, token) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError('Không thể kết nối máy chủ API WorkShift. Vui lòng kiểm tra lại dịch vụ tại cổng 3001.', 503, 'API_UNAVAILABLE');
    }
    throw error;
  }

  // Handle CSV download
  if (response.headers.get('content-type')?.includes('text/csv')) {
    if (!response.ok) throw new ApiError('Không thể tải tệp CSV báo cáo.', response.status);
    return response.blob();
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = body.error ?? body.message ?? 'Yêu cầu không thành công.';
    throw new ApiError(errorMsg, response.status, body.code);
  }
  return body;
}

export async function api(path, init = {}) {
  const token = await tokenProvider?.();
  if (!token) throw new ApiError('Phiên đăng nhập đã hết hạn hoặc chưa xác thực.', 401, 'UNAUTHENTICATED');
  return request(path, init, token);
}

// ---------------- AUTH ----------------
export function loginWithPassword(email, password) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function requestPasswordResetOtp(identifier) {
  return request('/auth/password-reset/request-otp', {
    method: 'POST',
    body: JSON.stringify({ identifier })
  });
}

export function confirmPasswordReset({ identifier, otpCode, newPassword }) {
  return request('/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify({ identifier, otpCode, newPassword })
  });
}

export function changeTemporaryPassword(currentPassword, newPassword) {
  return api('/auth/change-temporary-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export function exchangeOAuthSession(clerkToken) {
  if (!clerkToken) throw new ApiError('Không thể xác minh phiên OAuth2.', 401, 'UNAUTHENTICATED');
  return request('/auth/oauth/exchange', { method: 'POST' }, clerkToken);
}

// ---------------- ATTENDANCE (All Roles) ----------------
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new ApiError('Trình duyệt không hỗ trợ định vị GPS.', 400, 'GPS_UNSUPPORTED'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, (error) => {
      const message = error.code === error.PERMISSION_DENIED
        ? 'Bạn cần cho phép truy cập vị trí để chấm công.'
        : 'Không lấy được vị trí GPS. Vui lòng bật định vị và thử lại.';
      reject(new ApiError(message, 400, 'GPS_UNAVAILABLE'));
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });
}

// When a response is lost, the server may already have recorded the request.
// Resending with the same key returns that record instead of creating another.
const pendingAttendanceRequests = new Map();
const attendanceAttempts = 3;

async function submitAttendance(path) {
  const position = await currentPosition();
  const requestId = pendingAttendanceRequests.get(path) ?? crypto.randomUUID();
  pendingAttendanceRequests.set(path, requestId);
  const body = JSON.stringify({
    requestId,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    capturedAt: new Date(position.timestamp).toISOString()
  });

  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await api(path, { method: 'POST', body });
      pendingAttendanceRequests.delete(path);
      return result;
    } catch (error) {
      // A 4xx is a final answer; a network error or 5xx leaves the outcome unknown.
      const outcomeUnknown = !(error instanceof ApiError) || error.status >= 500;
      if (!outcomeUnknown) pendingAttendanceRequests.delete(path);
      if (!outcomeUnknown || attempt === attendanceAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

export function checkInAttendance() {
  return submitAttendance('/attendance/checkin');
}

export function employeeCheckOut() {
  return submitAttendance('/attendance/checkout');
}

// ---------------- EMPLOYEE WORKSPACE (/api/v1/employee) ----------------

export function getEmployeeAttendance(month) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return api(`/employee/attendance${query}`);
}

export function getEmployeeRequests() {
  return api('/employee/requests');
}

export function createEmployeeRequest(data) {
  return api('/employee/requests', { method: 'POST', body: JSON.stringify(data) });
}

export function getEmployeeSchedule() {
  return api('/employee/schedule');
}

export function getEmployeeLeaveBalance() {
  return api('/employee/leave-balance');
}

export function updateEmployeeProfile(data) {
  return api('/employee/profile', { method: 'PATCH', body: JSON.stringify(data) });
}

// ---------------- HR WORKSPACE (/api/v1/hr) ----------------
export function getHrEmployees() {
  return api('/hr/employees');
}

export function updateHrEmployee(id, data) {
  return api(`/hr/employees/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function getHrDepartments() {
  return api('/hr/departments');
}

export function getHrShifts() {
  return api('/hr/shifts');
}

export function createHrShift(data) {
  return api('/hr/shifts', { method: 'POST', body: JSON.stringify(data) });
}

export function updateHrShift(id, data) {
  return api(`/hr/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function assignHrShift(data) {
  return api('/hr/shift-assignments', { method: 'POST', body: JSON.stringify(data) });
}

export function getHrRequests() {
  return api('/hr/requests');
}

export function reviewHrRequest(id, data) {
  return api(`/hr/requests/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function getHrAttendance(month) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return api(`/hr/attendance${query}`);
}

export function adjustHrAttendance(id, data) {
  return api(`/hr/attendance/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function downloadAttendanceCsv() {
  const token = await tokenProvider?.();
  const blob = await request('/hr/reports/attendance.csv', {}, token);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bao-cao-cham-cong-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ---------------- SUPPORT TICKETS (/api/v1/support) ----------------
export function getSupportTickets() {
  return api('/support/tickets');
}

export function createSupportTicket(data) {
  return api('/support/tickets', { method: 'POST', body: JSON.stringify(data) });
}

// ---------------- COMPANY & ADMIN CORE (/api/v1/company, /api/v1/admin) ----------------
export function getCompanyWifi() {
  return api('/company/wifi');
}

export function updateCompanyIp(allowedIp) {
  const body = allowedIp ? { allowedIp } : {};
  return api('/company/ip', { method: 'PATCH', body: JSON.stringify(body) });
}

export function getOffices() {
  return api('/admin/offices');
}

export function createOffice(data) {
  return api('/admin/offices', { method: 'POST', body: JSON.stringify(data) });
}

export function updateOffice(id, data) {
  return api(`/admin/offices/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteOffice(id) {
  return api(`/admin/offices/${id}`, { method: 'DELETE' });
}

export function getEmployees() {
  return api('/admin/employees');
}

export function inviteEmployee(data) {
  return api('/admin/employees', { method: 'POST', body: JSON.stringify(data) });
}

export function inviteEmployeesBulk(employees) {
  return api('/admin/employees/bulk-invitations', { method: 'POST', body: JSON.stringify({ employees }) });
}

export function updateEmployee(id, data) {
  return api(`/admin/employees/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteEmployee(id) {
  return api(`/admin/employees/${id}`, { method: 'DELETE' });
}

export function deleteEmployeeBiometrics(id) {
  return api(`/admin/employees/${id}/biometrics`, { method: 'DELETE' });
}

export function sendCompanyEmail(data) {
  return api('/admin/emails', { method: 'POST', body: JSON.stringify(data) });
}

export function getAdminSummary(date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return api(`/admin/summary${query}`);
}

export function getAdminFlags(page = 1, size = 20) {
  return api(`/admin/flags?page=${page}&size=${size}`);
}

export function reviewAttendance(id, isFlagged = false, reviewNote = 'Đã xem xét và xử lý bởi Quản trị viên.') {
  return api(`/admin/attendance/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ isFlagged, reviewNote })
  });
}

export function dispatchNotifications(limit = 25) {
  return api('/admin/notifications/dispatch', { method: 'POST', body: JSON.stringify({ limit }) });
}

// ---------------- SYSTEM ADMIN (/api/v1/system) ----------------
export function getSystemDashboard() {
  return api('/system/dashboard');
}

export function getSystemCompanies() {
  return api('/system/companies');
}

export function createSystemCompany(data) {
  return api('/system/companies', { method: 'POST', body: JSON.stringify(data) });
}

export function updateSystemCompany(id, data) {
  return api(`/system/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function provisionSystemCompanyHr(id, data) {
  return api(`/system/companies/${id}/provision-hr`, { method: 'POST', body: JSON.stringify(data) });
}

export function deleteSystemCompany(id) {
  return api(`/system/companies/${id}`, { method: 'DELETE' });
}

export function getSystemSettings() {
  return api('/system/settings');
}

export function saveSystemSetting(data) {
  return api('/system/settings', { method: 'POST', body: JSON.stringify(data) });
}

export function getSystemEmailTemplates() {
  return api('/system/email-templates');
}

export function saveSystemEmailTemplate(data) {
  return api('/system/email-templates', { method: 'POST', body: JSON.stringify(data) });
}

export function getSystemIntegrations() {
  return api('/system/integrations');
}

export function saveSystemIntegration(data) {
  return api('/system/integrations', { method: 'POST', body: JSON.stringify(data) });
}

export function getSystemAuditLogs(page = 1, size = 30) {
  return api(`/system/audit-logs?page=${page}&size=${size}`);
}

export function getSystemIpRules() {
  return api('/system/ip-rules');
}

export function createSystemIpRule(data) {
  return api('/system/ip-rules', { method: 'POST', body: JSON.stringify(data) });
}

export function getSystemUsers() {
  return api('/system/users');
}

export function toggleUserSession(userId, active) {
  return api(`/system/users/${userId}/session`, { method: 'PATCH', body: JSON.stringify({ active }) });
}

export function getSystemTickets() {
  return api('/system/tickets');
}

export function updateSystemTicket(id, data) {
  return api(`/system/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function startImpersonation(companyId, reason) {
  return api(`/system/companies/${companyId}/impersonation`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function getSystemSmtpStatus() {
  return api('/system/smtp/status');
}

export function verifySystemSmtp() {
  return api('/system/smtp/verify', { method: 'POST' });
}

export function sendSystemTestEmail(toEmail) {
  return api('/system/smtp/test', { method: 'POST', body: JSON.stringify({ toEmail }) });
}

// ---------------- COMPATIBILITY ALIASES ----------------
export const employeeCheckout = employeeCheckOut;
export const getGlobalIpRules = getSystemIpRules;
export const createGlobalIpRule = createSystemIpRule;
export const getEmailTemplates = getSystemEmailTemplates;
export const saveEmailTemplate = saveSystemEmailTemplate;
export const startCompanyImpersonation = (companyId, reason) => startImpersonation(companyId, reason);
export const setAccountSession = (userId, active) => toggleUserSession(userId, active);
export const updateSupportTicket = (id, data) => updateSystemTicket(id, data);
