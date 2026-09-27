import nodemailer from 'nodemailer';
import { isCompanyEmail } from '../lib/access.js';
import { HttpError } from '../lib/errors.js';
import { getConfig } from '../lib/config.js';
import { createServiceClient } from '../lib/supabase.js';
import { ticketReference } from '../lib/ticket-reference.js';

let transporter;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function emailLayout({ title, preview, contentHtml, footerText }) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title || 'WorkShift')}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    .wrapper { width: 100%; max-width: 600px; margin: 0 auto; padding: 32px 16px; }
    .card { background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #4338ca, #6366f1); padding: 28px 32px; text-align: left; }
    .header h1 { color: #ffffff; font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.5px; }
    .header p { color: #e0e7ff; font-size: 13px; margin: 4px 0 0; }
    .body { padding: 32px; font-size: 14px; line-height: 1.6; color: #334155; }
    .highlight-box { background: #f1f5f9; border-radius: 12px; border: 1px solid #cbd5e1; padding: 16px 20px; margin: 20px 0; }
    .btn { display: inline-block; background: #4f46e5; color: #ffffff !important; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-size: 14px; margin-top: 16px; }
    .footer { text-align: center; padding: 24px 16px 0; font-size: 12px; color: #94a3b8; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>WorkShift</h1>
        <p>Nền tảng Chấm công & Quản trị Doanh nghiệp Thông minh</p>
      </div>
      <div class="body">
        ${contentHtml}
      </div>
    </div>
    <div class="footer">
      <p>${escapeHtml(footerText || 'Email này được gửi tự động từ hệ thống WorkShift. Vui lòng không trả lời trực tiếp email này nếu không có yêu cầu.')}</p>
      <p>© ${new Date().getFullYear()} WorkShift Platform. Tất cả các quyền được bảo lưu.</p>
    </div>
  </div>
</body>
</html>`;
}

export function getTransporter() {
  const { smtp } = getConfig();
  if (!smtp) throw new HttpError(503, 'SMTP chưa được cấu hình. Vui lòng thiết lập biến môi trường SMTP trong cấu hình hệ thống.', 'SMTP_NOT_CONFIGURED');
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      pool: true,
      auth: { user: smtp.user, pass: smtp.pass },
      // The server certificate is verified (Node's default); skipping it would
      // expose the SMTP password and every email, including reset codes, to
      // anyone able to intercept the connection.
      disableFileAccess: true,
      disableUrlAccess: true
    });
  }
  return { transporter, from: smtp.from };
}

export async function verifySmtpConnection() {
  const { transporter: smtp, from } = getTransporter();
  try {
    await smtp.verify();
    return {
      connected: true,
      message: 'Kết nối máy chủ SMTP thành công!',
      from
    };
  } catch (error) {
    console.error('SMTP verification failed:', error);
    throw new HttpError(503, `Không thể kết nối đến máy chủ SMTP: ${error.message}`, 'SMTP_CONNECTION_FAILED');
  }
}

export async function sendGeneralEmail({ to, subject, text, html, replyTo, attachments, headers }) {
  const recipients = Array.isArray(to) ? to : [to];
  if (!recipients.length) throw new HttpError(422, 'Thiếu địa chỉ email người nhận.', 'MISSING_RECIPIENT');

  const { transporter: smtp, from } = getTransporter();
  const mailHtml = html || emailLayout({
    title: subject,
    contentHtml: `<p>${textToHtml(text)}</p>`
  });

  const info = await smtp.sendMail({
    from,
    to: recipients,
    subject,
    text: text || 'Vui lòng sử dụng trình đọc hỗ trợ HTML để xem nội dung email.',
    html: mailHtml,
    ...(replyTo && { replyTo }),
    ...(attachments && { attachments }),
    ...(headers && { headers })
  });

  return { messageId: info.messageId, accepted: info.accepted, recipients: recipients.length };
}

export async function sendTestEmail({ toEmail }) {
  const config = getConfig();
  const subject = `[WorkShift] Kiểm tra cấu hình SMTP thành công — ${new Date().toLocaleTimeString('vi-VN')}`;
  const contentHtml = `
    <h2 style="margin-top:0; color:#1e293b; font-size:18px;">Xin chào Quản trị viên,</h2>
    <p>Hệ thống WorkShift đã kết nối và gửi thử nghiệm email qua máy chủ SMTP thành công!</p>
    <div class="highlight-box">
      <p style="margin:4px 0;"><b>Thời gian gửi:</b> ${new Date().toLocaleString('vi-VN')}</p>
      <p style="margin:4px 0;"><b>SMTP Host:</b> ${escapeHtml(config.smtp?.host || 'N/A')}</p>
      <p style="margin:4px 0;"><b>SMTP Port:</b> ${config.smtp?.port || 587}</p>
      <p style="margin:4px 0;"><b>Địa chỉ gửi (FROM):</b> ${escapeHtml(config.smtp?.from || 'N/A')}</p>
      <p style="margin:4px 0;"><b>Người nhận (TO):</b> ${escapeHtml(toEmail)}</p>
    </div>
    <p>Toàn bộ chức năng gửi thông báo chấm công, bàn giao tài khoản HR và trả lời ticket qua email đã sẵn sàng hoạt động.</p>
  `;

  return sendGeneralEmail({
    to: toEmail,
    subject,
    text: `WorkShift SMTP Test: Cấu hình SMTP hoạt động bình thường lúc ${new Date().toLocaleString('vi-VN')}.`,
    html: emailLayout({ title: subject, contentHtml })
  });
}

export async function sendHrWelcomeEmail({ email, fullName, companyName, temporaryPassword }) {
  const config = getConfig();
  const loginUrl = `${config.webOrigin}/login`;
  const subject = `[WorkShift] Thông tin Tài khoản Quản trị HR — ${companyName}`;
  const contentHtml = `
    <h2 style="margin-top:0; color:#1e293b; font-size:18px;">Xin chào ${escapeHtml(fullName || 'Quản trị viên')},</h2>
    <p>Doanh nghiệp <b>${escapeHtml(companyName)}</b> đã được khởi tạo thành công trên hệ thống <b>WorkShift</b>.</p>
    <p>Dưới đây là thông tin đăng nhập dành riêng cho bộ phận Quản lý Nhân sự (HR):</p>
    <div class="highlight-box">
      <p style="margin:6px 0;"><b>Email đăng nhập:</b> <code style="color:#4f46e5; font-size:14px;">${escapeHtml(email)}</code></p>
      <p style="margin:6px 0;"><b>Mật khẩu tạm thời:</b> <code style="color:#dc2626; font-size:14px; font-weight:bold;">${escapeHtml(temporaryPassword)}</code></p>
      <p style="margin:6px 0; font-size:12px; color:#64748b;"><i>* Hệ thống sẽ yêu cầu bạn đổi mật khẩu mới trong lần đăng nhập đầu tiên để đảm bảo bảo mật.</i></p>
    </div>
    <div style="text-align:center; margin: 24px 0;">
      <a href="${loginUrl}" class="btn" style="color:#ffffff;">Đăng nhập Bàn làm việc HR</a>
    </div>
    <p style="font-size:13px; color:#64748b;">Nếu nút trên không hoạt động, bạn có thể sao chép liên kết sau vào trình duyệt: <br><a href="${loginUrl}">${loginUrl}</a></p>
  `;

  return sendGeneralEmail({
    to: email,
    subject,
    text: `Xin chào ${fullName}, thông tin đăng nhập WorkShift HR của bạn: Email: ${email}, Mật khẩu tạm thời: ${temporaryPassword}. Đăng nhập tại: ${loginUrl}`,
    html: emailLayout({ title: subject, contentHtml })
  });
}

export async function sendPasswordResetOtpEmail({ to, fullName, code }) {
  const subject = '[WorkShift] Mã xác thực đặt lại mật khẩu';
  const contentHtml = `
    <h2 style="margin-top:0; color:#1e293b; font-size:18px;">Đặt lại mật khẩu</h2>
    <p>Xin chào <b>${escapeHtml(fullName || 'bạn')}</b>,</p>
    <p>Mã xác thực để đặt lại mật khẩu WorkShift của bạn là:</p>
    <div class="highlight-box">
      <p style="margin:4px 0; font-size:24px; letter-spacing:6px;"><b>${escapeHtml(code)}</b></p>
    </div>
    <p>Mã có hiệu lực trong 5 phút và chỉ dùng được một lần. Không chia sẻ mã này với bất kỳ ai.</p>
    <p>Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Mật khẩu của bạn vẫn giữ nguyên.</p>
  `;

  return sendGeneralEmail({
    to,
    subject,
    text: `Mã xác thực đặt lại mật khẩu WorkShift: ${code}. Mã có hiệu lực trong 5 phút. Không chia sẻ mã này với bất kỳ ai.`,
    html: emailLayout({ title: subject, contentHtml })
  });
}

export async function sendTicketAutoResponderEmail({ to, ticketId, subject: ticketSubject, companyName }) {
  // Replies are matched to the ticket only through this signed reference.
  const reference = ticketReference(ticketId);
  const subject = `[WorkShift Support ${reference}] Đã tiếp nhận yêu cầu: ${ticketSubject}`;
  const contentHtml = `
    <h2 style="margin-top:0; color:#1e293b; font-size:18px;">Yêu cầu hỗ trợ của bạn đã được ghi nhận</h2>
    <p>Xin chào quý khách,</p>
    <p>WorkShift đã tiếp nhận yêu cầu hỗ trợ từ bạn với các thông tin sau:</p>
    <div class="highlight-box">
      <p style="margin:4px 0;"><b>Mã Ticket:</b> <code>${escapeHtml(ticketId)}</code></p>
      <p style="margin:4px 0;"><b>Mã phản hồi:</b> <code>${escapeHtml(reference)}</code></p>
      <p style="margin:4px 0;"><b>Tiêu đề:</b> ${escapeHtml(ticketSubject)}</p>
      <p style="margin:4px 0;"><b>Thời gian tiếp nhận:</b> ${new Date().toLocaleString('vi-VN')}</p>
      <p style="margin:4px 0;"><b>Trạng thái:</b> Đang xử lý (OPEN)</p>
    </div>
    <p>Đội ngũ kỹ thuật và hỗ trợ khách hàng của WorkShift sẽ xem xét và phản hồi trong thời gian sớm nhất.</p>
    <p>Bạn có thể trả lời trực tiếp email này để bổ sung thêm thông tin. Vui lòng giữ nguyên tiêu đề hoặc mã phản hồi ở trên.</p>
  `;

  return sendGeneralEmail({
    to,
    subject,
    text: `WorkShift đã tiếp nhận yêu cầu #${ticketId}: ${ticketSubject}. Chúng tôi sẽ phản hồi sớm nhất. Mã phản hồi: ${reference}`,
    html: emailLayout({ title: subject, contentHtml })
  });
}

function content(notification) {
  if (notification.kind === 'ATTENDANCE_FLAGGED') {
    const flags = Array.isArray(notification.payload?.flags) ? notification.payload.flags.join(', ') : 'UNKNOWN';
    return {
      subject: '[WorkShift] Lượt chấm công cần xem xét',
      text: `Xin chào ${notification.full_name}, lượt chấm công của bạn cần HR xem xét. Tín hiệu: ${flags}.`,
      html: emailLayout({
        title: '[WorkShift] Lượt chấm công cần xem xét',
        contentHtml: `
          <h2 style="margin-top:0; color:#1e293b; font-size:18px;">Thông báo Chấm công</h2>
          <p>Xin chào <b>${escapeHtml(notification.full_name)}</b>,</p>
          <p>Lượt chấm công của bạn đã được ghi nhận nhưng cần quản trị viên hoặc HR xem xét:</p>
          <div class="highlight-box">
            <p style="margin:4px 0;"><b>Tín hiệu cảnh báo:</b> ${escapeHtml(flags)}</p>
            <p style="margin:4px 0;"><b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}</p>
          </div>
          <p>Vui lòng liên hệ bộ phận HR công ty nếu bạn có bất kỳ thắc mắc nào.</p>
        `
      })
    };
  }
  return {
    subject: '[WorkShift] Thông báo mới',
    text: 'Bạn có thông báo mới từ WorkShift.',
    html: emailLayout({
      title: '[WorkShift] Thông báo mới',
      contentHtml: '<p>Bạn có thông báo mới từ hệ thống WorkShift.</p>'
    })
  };
}

export async function dispatchPendingNotifications(limit = 25) {
  const { transporter: smtp, from } = getTransporter();
  const supabase = createServiceClient();
  const { data: pending, error } = await supabase.rpc('claim_pending_notifications', { p_limit: limit });
  if (error) throw new HttpError(502, 'Không thể lấy hàng đợi email.', 'DATABASE_ERROR');
  let sent = 0; let failed = 0;
  for (const notification of pending ?? []) {
    try {
      const mail = content(notification);
      await smtp.sendMail({ from, to: notification.email, subject: mail.subject, text: mail.text, html: mail.html });
      const { error: updateError } = await supabase.from('notification_outbox')
        .update({ status: 'SENT', sent_at: new Date().toISOString(), locked_at: null, last_error: null }).eq('id', notification.id);
      if (updateError) throw updateError;
      sent += 1;
    } catch (reason) {
      const status = notification.attempts >= 3 ? 'FAILED' : 'PENDING';
      await supabase.from('notification_outbox')
        .update({ status, locked_at: null, last_error: reason instanceof Error ? reason.message.slice(0, 500) : 'SMTP delivery failed' })
        .eq('id', notification.id);
      failed += 1;
    }
  }
  return { claimed: pending?.length ?? 0, sent, failed };
}

export async function sendContactDetailsChangedEmail({ recipients, fullName, emailChanged = false, phoneChanged = false, changedBy }) {
  const uniqueRecipients = [...new Set((Array.isArray(recipients) ? recipients : [recipients])
    .map((email) => String(email ?? '').trim().toLowerCase())
    .filter(Boolean))];
  if (!uniqueRecipients.length) return { sent: 0 };

  const changedFields = [
    emailChanged ? 'địa chỉ email đăng nhập' : null,
    phoneChanged ? 'số điện thoại liên hệ' : null
  ].filter(Boolean).join(' và ');
  const actorText = changedBy ? ` bởi ${changedBy}` : '';
  const subject = '[WorkShift] Xác nhận thay đổi thông tin tài khoản';
  const contentHtml = `
    <h2 style="margin-top:0; color:#1e293b; font-size:18px;">Xác nhận thay đổi thông tin</h2>
    <p>Xin chào <b>${escapeHtml(fullName || 'bạn')}</b>,</p>
    <p>${escapeHtml(`Thông tin ${changedFields || 'tài khoản'} của bạn vừa được cập nhật${actorText}.`)}</p>
    <div class="highlight-box">
      <p style="margin:4px 0;"><b>Thời gian:</b> ${escapeHtml(new Date().toLocaleString('vi-VN'))}</p>
      <p style="margin:4px 0;"><b>Nội dung:</b> ${escapeHtml(changedFields || 'Thông tin tài khoản')}</p>
    </div>
    <p style="font-size:13px; color:#64748b;">Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ ngay bộ phận quản trị WorkShift của công ty.</p>
  `;
  const text = `Xin chào ${fullName || 'bạn'}, ${changedFields || 'thông tin tài khoản'} của bạn vừa được cập nhật${actorText} lúc ${new Date().toLocaleString('vi-VN')}. Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ ngay bộ phận quản trị WorkShift.`;

  await Promise.all(uniqueRecipients.map((to) => sendGeneralEmail({
    to,
    subject,
    text,
    html: emailLayout({ title: subject, contentHtml })
  })));
  return { sent: uniqueRecipients.length };
}

export async function sendCompanyEmail({ to, subject, text }) {
  const recipients = Array.isArray(to) ? to : [to];
  if (!recipients.length || recipients.some((email) => !isCompanyEmail(email))) {
    throw new HttpError(403, 'Chỉ được gửi email đến địa chỉ @company.com.', 'EMAIL_DOMAIN_FORBIDDEN');
  }
  return sendGeneralEmail({
    to: recipients,
    subject,
    text,
    html: emailLayout({
      title: subject,
      contentHtml: `<p>${textToHtml(text)}</p>`
    })
  });
}
