import { describe, expect, it } from 'vitest';
import { isAllowedEmailForRole, isAuthorizedEmail, isCompanyEmail, isSystemAdminEmail } from '../src/lib/access.js';

describe('company access policy', () => {
  it('keeps the configured Gmail account as the only system administrator', () => {
    expect(isSystemAdminEmail('hungblockchain06@gmail.com')).toBe(true);
    expect(isSystemAdminEmail('other@company.com')).toBe(false);
  });

  it('requires corporate email for HR and Gmail for employees', () => {
    expect(isCompanyEmail('hr@company.com')).toBe(true);
    expect(isAllowedEmailForRole('hr@company.com', 'HR')).toBe(true);
    expect(isAllowedEmailForRole('employee@gmail.com', 'EMPLOYEE')).toBe(true);
    expect(isAllowedEmailForRole('employee@company.com', 'EMPLOYEE')).toBe(false);
    expect(isAllowedEmailForRole('hr@gmail.com', 'HR')).toBe(false);
    expect(isAuthorizedEmail('employee@gmail.com')).toBe(true);
    expect(isAuthorizedEmail('staff@external.example')).toBe(false);
  });
});
