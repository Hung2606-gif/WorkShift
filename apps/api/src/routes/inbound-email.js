import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { createServiceClient } from '../lib/supabase.js';
import { audit, clientIp } from '../services/audit.js';
import { sendTicketAutoResponderEmail } from '../services/notifications.js';
import { getConfig } from '../lib/config.js';
import { ticketIdFromReference } from '../lib/ticket-reference.js';

export const inboundEmailRouter = Router();

// The endpoint is public, so the provider must present the shared secret in the
// X-Webhook-Secret header, or as ?token= for providers that cannot set headers.
// Without it anyone could open tickets as any user and make the API send email
// to any address.
function assertInboundSecret(req) {
  const expected = getConfig().inboundEmailSecret;
  if (!expected) throw new HttpError(503, 'Chức năng nhận email chưa được cấu hình.', 'INBOUND_EMAIL_DISABLED');
  const received = Buffer.from(String(req.get('x-webhook-secret') ?? req.query.token ?? ''));
  const secret = Buffer.from(expected);
  if (received.length !== secret.length || !timingSafeEqual(received, secret)) {
    throw new HttpError(401, 'Webhook email không hợp lệ.', 'INVALID_WEBHOOK_SECRET');
  }
}

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
  assertInboundSecret(req);
  const payload = parseInboundPayload(req.body);
  const fromEmail = extractEmailAddress(payload.from);
  const toEmail = extractEmailAddress(payload.to);

  if (!fromEmail) {
    throw new HttpError(400, 'Không tìm thấy địa chỉ email người gửi hợp lệ.', 'INVALID_INBOUND_EMAIL');
  }

  const db = createServiceClient();

  // The From address can be forged, so it never identifies a user or grants
  // access. The mailbox the email was delivered to chooses the company first;
  // the sender's apparent company is only a fallback for routing.
  let targetCompany = null;
  if (toEmail) {
    const { data } = await db.from('companies')
      .select('id, name')
      .eq('company_email', toEmail)
      .maybeSingle();
    targetCompany = data;
  }
  if (!targetCompany) {
    const { data: sender } = await db.from('users')
      .select('companies(id, name)')
      .eq('email', fromEmail)
      .maybeSingle();
    targetCompany = sender?.companies ?? null;
  }
  if (!targetCompany) {
    const { data } = await db.from('companies')
      .select('id, name')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    targetCompany = data;
  }
  const targetCompanyId = targetCompany?.id ?? null;

  if (!targetCompanyId) {
    throw new HttpError(422, 'Hệ thống chưa có doanh nghiệp nào để gắn ticket.', 'NO_TENANT_AVAILABLE');
  }

  const subject = String(payload.subject || 'Yêu cầu hỗ trợ qua Email').trim();
  const rawBody = String(payload.text || payload.html || '(Nội dung email trống)').trim();

  // Only a reply quoting the signed reference from the ticket's auto-responder
  // email can append to that ticket; a known ticket ID alone is not enough.
  const ticketId = ticketIdFromReference(`${subject}\n${rawBody}`);
  let existingTicket = null;

  if (ticketId) {
    const { data: t } = await db.from('support_tickets')
      .select('id, company_id, subject, description, status')
      .eq('id', ticketId)
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

    await audit(null, 'INBOUND_EMAIL_TICKET_REPLY', {
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
        created_by: null,
        subject: subject.slice(0, 200),
        description: `[Email từ: ${fromEmail} (địa chỉ người gửi chưa được xác minh)]\n\n${rawBody}`,
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
          companyName: targetCompany.name || 'Doanh nghiệp'
        });
      }
    } catch (mailErr) {
      console.warn('Could not send inbound auto-responder email:', mailErr.message);
    }

    await audit(null, 'INBOUND_EMAIL_TICKET_CREATED', {
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
