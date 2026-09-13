import { describe, expect, it } from 'vitest';
import { generateStrongTemporaryPassword, formatClerkError } from '../src/lib/passwords.js';

describe('Password generation and Clerk error formatting', () => {
  it('generates secure passwords with 16+ characters and symbols', () => {
    for (let i = 0; i < 20; i++) {
      const pwd = generateStrongTemporaryPassword();
      expect(pwd.length).toBeGreaterThanOrEqual(16);
      expect(pwd).toMatch(/[A-Z]/);
      expect(pwd).toMatch(/[a-z]/);
      expect(pwd).toMatch(/[0-9]/);
      expect(pwd).toMatch(/[!@#$%^&*]/);
    }
  });

  it('formats length errors dynamically from Clerk response', () => {
    const errorWith15 = {
      errors: [{
        code: 'form_password_length_too_short',
        message: 'Passwords must be 15 characters or more.',
        longMessage: 'Passwords must be 15 characters or more.'
      }]
    };
    const formatted = formatClerkError(errorWith15);
    expect(formatted).toContain('15 ký tự');
  });

  it('formats pwned password error properly', () => {
    const pwnedError = {
      errors: [{
        code: 'form_password_pwned',
        message: 'Password was found in a breach'
      }]
    };
    const formatted = formatClerkError(pwnedError);
    expect(formatted).toContain('pwned');
  });

  it('formats identifier exists error properly', () => {
    const existsError = {
      errors: [{
        code: 'form_identifier_exists',
        message: 'Identifier exists'
      }]
    };
    const formatted = formatClerkError(existsError);
    expect(formatted).toContain('đã được sử dụng');
  });
});
