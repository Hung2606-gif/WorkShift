import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { createServiceClient } from '../lib/supabase.js';
import { audit, clientIp } from '../services/audit.js';
import { sendTicketAutoResponderEmail } from '../services/notifications.js';
import { getConfig } from '../lib/config.js';

export const inboundEmailRouter = Router();

function extractEmailAddress(raw) {
  if (!raw) return '';
  const match = String(raw).match(/<([^>]+)>/) || String(raw).match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function parseInboundPayload(body) {
  // 1. Resend Webhook format: { type: 'email.received', data: { from, to, subject, text, html } }
  if (body?.type === 'email.received' && body?.data) {
    const d = body.data;
    return {
      from: Array.isArray(d.from) ? d.from[0] : d.from,
      to: Array.isArray(d.to) ? d.to[0] : d.to,
      subject: d.subject || 'Không có tiêu đề',
      text: d.text || '',
      html: d.html || '',
      messageId: d.id || d.message_id
    };
  }

  // 2. Postmark format: { From, To, Subject, TextBody, HtmlBody, MessageID }
  if (body?.From && (body?.TextBody || body?.HtmlBody)) {
    return {
      from: body.From,
      to: body.To,
      subject: body.Subject || 'Không có tiêu đề',
      text: body.TextBody || '',
      html: body.HtmlBody || '',
      messageId: body.MessageID
    };
  }

  // 3. Mailgun format: { sender, recipient, subject, 'body-plain', 'body-html' }
  if (body?.sender && (body?.['body-plain'] || body?.['body-html'])) {
    return {
      from: body.sender,
      to: body.recipient,
      subject: body.subject || 'Không có tiêu đề',
      text: body['body-plain'] || '',
      html: body['body-html'] || '',
      messageId: body['Message-Id']
    };
  }

  // 4. SendGrid / Generic Webhook format: { from, to, subject, text, html }
  return {
    from: body?.from || body?.sender || body?.envelope?.from || '',
    to: body?.to || body?.recipient || body?.envelope?.to || '',
    subject: body?.subject || body?.Subject || 'Yêu cầu hỗ trợ qua Email',
    text: body?.text || body?.body || body?.['body-plain'] || '',
    html: body?.html || body?.['body-html'] || '',
    messageId: body?.messageId || body?.['message-id'] || null
  };
}

// Inbound Email Webhook Receiver: POST /api/v1/email/inbound
inboundEmailRouter.post('/inbound', asyncHandler(async (req, res) => {
  const payload = parseInboundPayload(req.body);
  const fromEmail = extractEmailAddress(payload.from);
  const toEmail = extractEmailAddress(payload.to);

  if (!fromEmail) {
    throw new HttpError(400, 'Không tìm thấy địa chỉ email người gửi hợp lệ.', 'INVALID_INBOUND_EMAIL');
  }

  const db = createServiceClient();

  // Find if sender belongs to any user in the system
  const { data: user } = await db.from('users')
    .select('id, full_name, email, company_id, role, companies(id, name, company_email)')
    .eq('email', fromEmail)
    .maybeSingle();

  let targetCompanyId = user?.company_id || null;

  // If no company found from sender, try finding company by recipient email
  if (!targetCompanyId && toEmail) {
    const { data: matchedCompany } = await db.from('companies')
      .select('id, name')
      .eq('company_email', toEmail)
      .maybeSingle();
    if (matchedCompany) {
      targetCompanyId = matchedCompany.id;
    }
  }

  // If still no company, fall back to first active company or system default
  if (!targetCompanyId) {
    const { data: firstCompany } = await db.from('companies')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    targetCompanyId = firstCompany?.id || null;
  }

  if (!targetCompanyId) {
    throw new HttpError(422, 'Hệ thống chưa có doanh nghiệp nào để gắn ticket.', 'NO_TENANT_AVAILABLE');
  }

  const subject = String(payload.subject || 'Yêu cầu hỗ trợ qua Email').trim();
  const rawBody = String(payload.text || payload.html || '(Nội dung email trống)').trim();

  // Check if this is a reply to an existing ticket: e.g. [WorkShift Support #12345678] or UUID
  const ticketIdMatch = subject.match(/#([a-f0-9-]{8,36})/i) || rawBody.match(/Ticket-ID:\s*([a-f0-9-]{8,36})/i);
  let existingTicket = null;

  if (ticketIdMatch) {
    const candidateId = ticketIdMatch[1];
    const { data: t } = await db.from('support_tickets')
      .select('id, company_id, subject, description, status')
      .or(`id.eq.${candidateId},id.ilike.${candidateId}%`)
      .maybeSingle();
    existingTicket = t;
  }

  let resultData;

  if (existingTicket) {
    // Append reply to existing ticket
    const updateTime = new Date().toLocaleString('vi-VN');
    const updatedDescription = `${existingTicket.description}\n\n--- Phản hồi qua Email từ ${fromEmail} (${updateTime}) ---\n${rawBody}`;
    
    await db.from('support_tickets')
      .update({
        description: updatedDescription,
        status: existingTicket.status === 'CLOSED' ? 'IN_PROGRESS' : existingTicket.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingTicket.id);

    await audit(user?.id || null, 'INBOUND_EMAIL_TICKET_REPLY', {
      ticketId: existingTicket.id,
      from: fromEmail,
      subject
    }, clientIp(req));

    resultData = {
      action: 'TICKET_REPLY_UPDATED',
      ticketId: existingTicket.id,
      subject: existingTicket.subject
    };
  } else {
    // Create new Support Ticket
    const { data: newTicket, error: ticketError } = await db.from('support_tickets')
      .insert({
        company_id: targetCompanyId,
        created_by: user?.id || null,
        subject: subject.slice(0, 200),
        description: `[Email từ: ${fromEmail}]\n\n${rawBody}`,
        priority: 'NORMAL',
        status: 'OPEN'
      })
      .select('id, subject, status, priority, created_at')
      .single();

    if (ticketError || !newTicket) {
      throw new HttpError(502, 'Không thể tạo ticket từ email gửi đến.', 'DATABASE_ERROR');
    }

    // Try sending auto-responder email if SMTP is configured
    try {
      const config = getConfig();
      if (config.smtp) {
        await sendTicketAutoResponderEmail({
          to: fromEmail,
          ticketId: newTicket.id,
          subject: newTicket.subject,
          companyName: user?.companies?.name || 'Doanh nghiệp'
        });
      }
    } catch (mailErr) {
      console.warn('Could not send inbound auto-responder email:', mailErr.message);
    }

    await audit(user?.id || null, 'INBOUND_EMAIL_TICKET_CREATED', {
      ticketId: newTicket.id,
      from: fromEmail,
      companyId: targetCompanyId,
      subject
    }, clientIp(req));

    resultData = {
      action: 'TICKET_CREATED',
      ticketId: newTicket.id,
      subject: newTicket.subject
    };
  }

  res.status(200).json({
    success: true,
    message: 'Đã tiếp nhận và xử lý email thành công.',
    data: resultData
  });
}));

// Inbound Email Webhook Info / Guide: GET /api/v1/email/inbound
inboundEmailRouter.get('/inbound', (req, res) => {
  const config = getConfig();
  const webhookUrl = `${req.protocol}://${req.get('host')}/api/v1/email/inbound`;
  res.json({
    status: 'active',
    endpoint: webhookUrl,
    supportedProviders: ['SendGrid Inbound Parse', 'Resend Inbound', 'Mailgun Routes', 'Postmark Inbound', 'Cloudflare Email Routing'],
    smtpConfigured: Boolean(config.smtp),
    instructions: 'Cấu hình Webhook URL này trên nhà cung cấp email (SendGrid, Resend, Mailgun...) để tự động nhận và chuyển đổi email thành Ticket hỗ trợ.'
  });
});
