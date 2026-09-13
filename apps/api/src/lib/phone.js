/**
 * Normalise the Vietnamese mobile formats accepted by the UI to E.164.
 *
 * The database uses the same rules in `normalize_workshift_phone`, so reset
 * lookups are stable even when a user entered spaces, dots, or dashes in
 * their profile.  WorkShift currently only sends recovery codes to Vietnamese
 * mobile numbers; accepting arbitrary international numbers here would make
 * the SMS-cost controls much harder to reason about.
 */
export function normalizeVietnameseMobile(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || input.length > 30 || !/^[0-9+().\s-]+$/.test(input)) return null;

  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  let normalized;
  if (digits.startsWith('84')) normalized = `+${digits}`;
  else if (digits.startsWith('0')) normalized = `+84${digits.slice(1)}`;
  else return null;

  // Vietnamese mobile numbers are +84 followed by 9 digits and one of the
  // currently allocated mobile prefixes 3, 5, 7, 8, or 9.
  return /^\+84[35789]\d{8}$/.test(normalized) ? normalized : null;
}

export function maskPhoneNumber(phoneE164) {
  const value = String(phoneE164 ?? '');
  return value.length >= 4 ? `***${value.slice(-4)}` : '***';
}
