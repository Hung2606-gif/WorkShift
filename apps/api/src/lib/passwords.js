import crypto from 'crypto';

/**
 * Generates a strong, high-entropy temporary password (17+ chars) that complies
 * with all Clerk security policies:
 * - Minimum 16+ characters (Clerk requires 15+ in this project environment)
 * - Contains uppercase, lowercase, numbers, and special symbols
 * - High unique entropy to avoid known breached/pwned password dictionaries
 */
export function generateStrongTemporaryPassword(length = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const numbers = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + numbers + symbols;

  const pwd = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    numbers[crypto.randomInt(numbers.length)],
    symbols[crypto.randomInt(symbols.length)],
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
  ];

  for (let i = pwd.length; i < length; i++) {
    pwd.push(all[crypto.randomInt(all.length)]);
  }

  // Cryptographic Durstenfeld shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }

  return `WS#${pwd.join('')}!26`;
}

/**
 * Formats any Clerk error into a clear, actionable Vietnamese error message.
 * Automatically parses required minimum lengths dynamically from Clerk's message.
 */
export function formatClerkError(err) {
  const clerkError = err?.errors?.[0] || err?.clerkErrors?.[0];
  const sanitizeMessage = (message) => String(message ?? '').replace(/\bclerk\b/gi, 'hệ thống xác thực');
  if (!clerkError) return sanitizeMessage(err?.message) || 'Yêu cầu không hợp lệ.';

  if (clerkError.code === 'form_password_length_too_short') {
    const rawMsg = clerkError.longMessage || clerkError.message || '';
    const match = rawMsg.match(/(\d+)\s*characters/i);
    const minChars = match ? match[1] : '15';
    return `Mật khẩu phải có tối thiểu ${minChars} ký tự theo chính sách bảo mật hệ thống (khuyến nghị để trống để hệ thống tự tạo).`;
  }

  if (clerkError.code === 'form_password_pwned') {
    return 'Mật khẩu quá thông dụng hoặc đã từng bị lộ trên internet (pwned). Vui lòng chọn mật khẩu phức tạp hơn hoặc để trống để hệ thống tự tạo mật khẩu an toàn.';
  }

  if (clerkError.code === 'form_password_validation_failed' || clerkError.code === 'form_password_not_strong_enough') {
    return 'Mật khẩu chưa đủ độ mạnh. Vui lòng kết hợp chữ hoa, chữ thường, chữ số và ký tự đặc biệt (tối thiểu 15 ký tự).';
  }

  if (clerkError.code === 'form_password_size_in_bytes_exceeded') {
    return 'Mật khẩu vượt quá độ dài tối đa cho phép.';
  }

  if (clerkError.code === 'form_identifier_exists') {
    return 'Email này đã được sử dụng bởi một tài khoản khác trong hệ thống xác thực.';
  }

  if (clerkError.code === 'form_param_format_invalid' || clerkError.code === 'form_param_nil') {
    return `Thông tin ${clerkError.meta?.paramName || 'gửi lên'} không đúng định dạng.`;
  }

  return sanitizeMessage(clerkError.longMessage || clerkError.message) || 'Mật khẩu hoặc thông tin không đạt yêu cầu bảo mật.';
}
