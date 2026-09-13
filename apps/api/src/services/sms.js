import { getConfig } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';

const REQUEST_TIMEOUT_MS = 10_000;

function messageForPasswordReset(code) {
  return `Ma xac nhan WorkShift cua ban la ${code}. Ma co hieu luc trong 5 phut. Khong chia se ma nay voi bat ky ai.`;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new HttpError(503, 'Dich vu gui SMS dang phan hoi cham. Vui long thu lai sau.', 'SMS_DELIVERY_FAILED');
    }
    throw new HttpError(503, 'Khong the ket noi dich vu gui SMS. Vui long thu lai sau.', 'SMS_DELIVERY_FAILED');
  } finally {
    clearTimeout(timeout);
  }
}

async function sendViaTwilio(sms, to, body) {
  const credentials = Buffer.from(`${sms.accountSid}:${sms.authToken}`).toString('base64');
  const form = new URLSearchParams({ To: to, From: sms.from, Body: body });
  const response = await fetchWithTimeout(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sms.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
    }
  );
  if (!response.ok) throw new HttpError(503, 'Nha cung cap SMS khong the gui ma xac nhan. Vui long thu lai sau.', 'SMS_DELIVERY_FAILED');
  const data = await response.json().catch(() => ({}));
  return { provider: 'TWILIO', messageId: data.sid ?? null };
}

/**
 * A provider-neutral option for Vietnamese SMS vendors or an in-house SMS
 * gateway.  The configured endpoint receives a JSON body:
 * `{ to, message, type: 'PASSWORD_RESET_OTP' }` and must return a 2xx status.
 */
async function sendViaWebhook(sms, to, body) {
  const response = await fetchWithTimeout(sms.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sms.token ? { Authorization: `Bearer ${sms.token}` } : {})
    },
    body: JSON.stringify({ to, message: body, type: 'PASSWORD_RESET_OTP' })
  });
  if (!response.ok) throw new HttpError(503, 'Nha cung cap SMS khong the gui ma xac nhan. Vui long thu lai sau.', 'SMS_DELIVERY_FAILED');
  const data = await response.json().catch(() => ({}));
  return { provider: 'WEBHOOK', messageId: data.messageId ?? data.id ?? null };
}

/** Send a password-reset code without logging or persisting the plaintext OTP. */
export async function sendPasswordResetOtpSms({ to, code }) {
  const sms = getConfig().sms;
  if (!sms) {
    throw new HttpError(503, 'Chuc nang SMS chua duoc cau hinh. Vui long lien he quan tri vien.', 'SMS_NOT_CONFIGURED');
  }
  const body = messageForPasswordReset(code);
  if (sms.provider === 'TWILIO') return sendViaTwilio(sms, to, body);
  if (sms.provider === 'WEBHOOK') return sendViaWebhook(sms, to, body);
  throw new HttpError(503, 'Nha cung cap SMS chua duoc cau hinh hop le.', 'SMS_NOT_CONFIGURED');
}
