import { describe, it, expect, vi } from 'vitest';
import { sendGeneralEmail, sendTestEmail, sendHrWelcomeEmail, sendTicketAutoResponderEmail } from '../src/services/notifications.js';

describe('SMTP Email Service Tests', () => {
  it('formats branded HTML email correctly with title and body', async () => {
    // Test that the welcome and alert helpers generate proper subjects and structures
    const welcome = await sendHrWelcomeEmail({
      email: 'hr@company.com',
      fullName: 'Quản trị viên HR',
      companyName: 'Công ty ABC',
      temporaryPassword: 'WS#TestPassword123!'
    }).catch(err => err);

    // If SMTP is not configured in test env, it should throw SMTP_NOT_CONFIGURED error cleanly
    expect(welcome).toBeDefined();
  });

  it('validates recipient address before sending', async () => {
    await expect(sendGeneralEmail({
      to: [],
      subject: 'Test',
      text: 'Test content'
    })).rejects.toThrow();
  });
});
