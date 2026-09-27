import 'dotenv/config';

const defaultCompanyEmailDomain = 'company.com';

export function getConfig() {
  const systemAdminEmail = (process.env.SYSTEM_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const companyEmailDomain = (process.env.COMPANY_EMAIL_DOMAIN ?? defaultCompanyEmailDomain).trim().toLowerCase().replace(/^@/, '');
  const appJwtSecret = process.env.APP_JWT_SECRET;

  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_WEBHOOK_SIGNING_SECRET', 'APP_JWT_SECRET', 'SYSTEM_ADMIN_EMAIL'];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
  }

  const smtpValues = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].map((name) => process.env[name]);
  const smtpConfigured = smtpValues.some(Boolean);
  if (smtpConfigured && smtpValues.some((value) => !value)) {
    throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM must be configured together.');
  }
  const smtpPort = Number(process.env.SMTP_PORT ?? '587');
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error('SMTP_PORT must be a valid port.');
  if (!/^\S+@\S+\.\S+$/.test(systemAdminEmail)) throw new Error('SYSTEM_ADMIN_EMAIL must be a valid email address.');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(companyEmailDomain)) throw new Error('COMPANY_EMAIL_DOMAIN must be a valid domain.');
  if (!appJwtSecret || appJwtSecret.length < 32) throw new Error('APP_JWT_SECRET must contain at least 32 characters.');

  const otpPepper = process.env.OTP_PEPPER || appJwtSecret;
  if (otpPepper.length < 32) throw new Error('OTP_PEPPER must contain at least 32 characters when configured.');

  // Shared secret the inbound email provider must send. Unset disables the endpoint.
  const inboundEmailSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET || null;
  if (inboundEmailSecret && inboundEmailSecret.length < 32) throw new Error('INBOUND_EMAIL_WEBHOOK_SECRET must contain at least 32 characters.');

  // Shift start/end times and work dates are wall-clock values in this zone.
  const attendanceTimezone = process.env.ATTENDANCE_TIMEZONE || 'Asia/Ho_Chi_Minh';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: attendanceTimezone });
  } catch {
    throw new Error('ATTENDANCE_TIMEZONE must be a valid IANA time zone.');
  }

  const smsProvider = (process.env.SMS_PROVIDER ?? '').trim().toUpperCase();
  let sms = null;
  if (smsProvider === 'TWILIO') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!accountSid || !authToken || !from) {
      throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM must be configured together.');
    }
    sms = { provider: 'TWILIO', accountSid, authToken, from };
  } else if (smsProvider === 'WEBHOOK') {
    const webhookUrl = process.env.SMS_WEBHOOK_URL;
    if (!webhookUrl) throw new Error('SMS_WEBHOOK_URL is required when SMS_PROVIDER=WEBHOOK.');
    try {
      const url = new URL(webhookUrl);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      throw new Error('SMS_WEBHOOK_URL must be a valid HTTP(S) URL.');
    }
    sms = { provider: 'WEBHOOK', webhookUrl, token: process.env.SMS_WEBHOOK_TOKEN || null };
  } else if (smsProvider) {
    throw new Error('SMS_PROVIDER must be TWILIO or WEBHOOK.');
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
    clerkWebhookSigningSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    systemAdminEmail,
    companyEmailDomain,
    appJwtSecret,
    otpPepper,
    attendanceTimezone,
    inboundEmailSecret,
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    port: Number(process.env.PORT ?? 3001),
    smtp: smtpConfigured ? {
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM
    } : null,
    sms
  };
}
