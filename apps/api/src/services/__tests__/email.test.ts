import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock nodemailer before any imports ─────────────────────────────
const mockSendMail = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: mockSendMail,
    }),
  },
}));

import {
  sendEmail,
  sendInviteEmail,
  sendSummaryReadyEmail,
  sendWelcomeEmail,
  _resetProvider,
} from '../email.js';

beforeEach(() => {
  _resetProvider();
  mockSendMail.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── ConsoleProvider (no SMTP_HOST) ─────────────────────────────────

describe('email service — ConsoleProvider', () => {
  beforeEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    _resetProvider();
  });

  it('logs to console when no SMTP_HOST is set', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({
      to: 'alice@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[email] DEV: would send to=alice@example.com'),
    );
    logSpy.mockRestore();
  });

  it('sendInviteEmail logs correctly in dev mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendInviteEmail({
      inviteeEmail: 'alice@example.com',
      hostName: 'bob@example.com',
      meetingTitle: 'Sprint Planning',
      inviteUrl: 'http://localhost:5173/invites/token123',
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('alice@example.com'),
    );
    logSpy.mockRestore();
  });

  it('sendWelcomeEmail logs correctly in dev mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendWelcomeEmail({
      displayName: 'Alice',
      email: 'alice@example.com',
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('alice@example.com'),
    );
    logSpy.mockRestore();
  });
});

// ── SmtpProvider (with SMTP_HOST) ──────────────────────────────────

describe('email service — SmtpProvider', () => {
  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.mailgun.org';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'postmaster@mg.example.com';
    process.env.SMTP_PASS = 'test-password';
    process.env.SMTP_FROM = 'MojoMeet <noreply@mg.example.com>';
    _resetProvider();
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    _resetProvider();
  });

  it('calls nodemailer sendMail with correct params', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: '<msg-123>', response: '250 OK' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail({
      to: 'alice@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'MojoMeet <noreply@mg.example.com>',
      to: 'alice@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    });
    logSpy.mockRestore();
  });

  it('handles array of recipients', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: '<msg-123>', response: '250 OK' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail({
      to: ['alice@example.com', 'bob@example.com'],
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alice@example.com, bob@example.com',
    }));
    logSpy.mockRestore();
  });

  it('sendInviteEmail calls SMTP with invite template', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: '<msg-123>', response: '250 OK' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendInviteEmail({
      inviteeEmail: 'alice@example.com',
      hostName: 'bob@example.com',
      meetingTitle: 'Sprint Planning',
      inviteUrl: 'http://localhost:5173/invites/token123',
    });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alice@example.com',
      subject: "You're invited to: Sprint Planning",
    }));
    logSpy.mockRestore();
  });

  it('sendSummaryReadyEmail calls SMTP with summary template', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: '<msg-123>', response: '250 OK' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendSummaryReadyEmail('alice@example.com', {
      recipientName: 'Alice',
      meetingTitle: 'Sprint Retro',
      summaryUrl: 'http://localhost:5173/meetings/abc/summary',
    });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alice@example.com',
      subject: 'Meeting summary ready: Sprint Retro',
    }));
    logSpy.mockRestore();
  });
});

// ── Error handling ─────────────────────────────────────────────────

describe('email service — error handling', () => {
  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.mailgun.org';
    process.env.SMTP_USER = 'postmaster@mg.example.com';
    process.env.SMTP_PASS = 'test-password';
    _resetProvider();
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    _resetProvider();
  });

  it('logs error and does not throw when SMTP fails', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Connection refused'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      sendEmail({
        to: 'alice@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith('[email] send failed:', expect.any(Error));
    errSpy.mockRestore();
  });

  it('sendInviteEmail does not throw on failure', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Timeout'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      sendInviteEmail({
        inviteeEmail: 'alice@example.com',
        hostName: 'bob@example.com',
        meetingTitle: 'Test',
        inviteUrl: 'http://localhost:5173/invites/token',
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('sendWelcomeEmail does not throw on failure', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Bad request'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      sendWelcomeEmail({ displayName: 'Alice', email: 'alice@example.com' }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('sendSummaryReadyEmail does not throw on failure', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Server error'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      sendSummaryReadyEmail('alice@example.com', {
        recipientName: 'Alice',
        meetingTitle: 'Retro',
        summaryUrl: 'http://localhost:5173/meetings/abc/summary',
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
