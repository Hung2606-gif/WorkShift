import { getConfig } from './config.js';

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isSystemAdminEmail(email) {
  return normalizeEmail(email) === getConfig().systemAdminEmail;
}

export function isCompanyEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.endsWith(`@${getConfig().companyEmailDomain}`);
}

export function isGmailEmail(email) {
  return normalizeEmail(email).endsWith('@gmail.com');
}

/** HR identities are corporate; employee identities are personal Gmail. */
export function isAllowedEmailForRole(email, role) {
  if (role === 'ADMIN') return isSystemAdminEmail(email);
  if (role === 'HR') return isCompanyEmail(email);
  if (role === 'EMPLOYEE') return isGmailEmail(email);
  return false;
}

export function isAuthorizedEmail(email) {
  return isSystemAdminEmail(email) || isCompanyEmail(email) || isGmailEmail(email);
}

export function isSystemAdmin(profile) {
  return profile?.role === 'ADMIN' && isSystemAdminEmail(profile.email);
}

export function assertCompanyEmail(email) {
  if (!isCompanyEmail(email)) {
    throw new Error(`Email phải thuộc domain @${getConfig().companyEmailDomain}.`);
  }
}
