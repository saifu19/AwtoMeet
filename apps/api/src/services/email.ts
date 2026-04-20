/**
 * Transactional email service — SMTP in production, console in dev.
 *
 * Follows the lazy singleton pattern from services/classify.ts.
 * Every public function is fire-and-forget: wraps in try/catch,
 * logs errors with [email] prefix, and never throws.
 *
 * Uses Nodemailer SMTP transport — compatible with Mailgun, SendGrid,
 * or any SMTP provider. Configure via SMTP_* env vars.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  inviteTemplate,
  summaryReadyTemplate,
  welcomeTemplate,
  type InviteEmailData,
  type SummaryReadyEmailData,
  type WelcomeEmailData,
} from './email-templates.js';

// ── Types ──────────────────────────────────────────────────────────

interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

interface EmailResult {
  id: string;
  message: string;
}

interface EmailProvider {
  send(msg: EmailMessage): Promise<EmailResult>;
}

// ── SMTP provider (Nodemailer) ─────────────────────────────────────

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }
  return _transporter;
}

class SmtpProvider implements EmailProvider {
  async send(msg: EmailMessage): Promise<EmailResult> {
    const from = process.env.SMTP_FROM ?? `MojoMeet <noreply@${process.env.SMTP_HOST}>`;
    const transport = getTransporter();
    const info = await transport.sendMail({
      from,
      to: Array.isArray(msg.to) ? msg.to.join(', ') : msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { id: info.messageId ?? '', message: info.response ?? '' };
  }
}

// ── Console provider (dev/test fallback) ───────────────────────────

class ConsoleProvider implements EmailProvider {
  async send(msg: EmailMessage): Promise<EmailResult> {
    const to = Array.isArray(msg.to) ? msg.to.join(', ') : msg.to;
    console.log(`[email] DEV: would send to=${to} subject="${msg.subject}"`);
    return { id: 'dev-noop', message: 'logged to console' };
  }
}

// ── Provider resolver ──────────────────────────────────────────────

let _provider: EmailProvider | null = null;

function getProvider(): EmailProvider {
  if (!_provider) {
    _provider = process.env.SMTP_HOST
      ? new SmtpProvider()
      : new ConsoleProvider();
  }
  return _provider;
}

/** Reset the cached provider — used in tests only. */
export function _resetProvider(): void {
  _provider = null;
  _transporter = null;
}

// ── Low-level send ─────────────────────────────────────────────────

export async function sendEmail(msg: EmailMessage): Promise<void> {
  try {
    const result = await getProvider().send(msg);
    console.log(`[email] sent id=${result.id} to=${Array.isArray(msg.to) ? msg.to.join(',') : msg.to}`);
  } catch (err) {
    console.error('[email] send failed:', err);
  }
}

// ── Typed senders ──────────────────────────────────────────────────

export async function sendInviteEmail(data: InviteEmailData): Promise<void> {
  try {
    const tpl = inviteTemplate(data);
    await sendEmail({ to: data.inviteeEmail, ...tpl });
  } catch (err) {
    console.error('[email] sendInviteEmail failed:', err);
  }
}

export async function sendSummaryReadyEmail(
  to: string,
  data: SummaryReadyEmailData,
): Promise<void> {
  try {
    const tpl = summaryReadyTemplate(data);
    await sendEmail({ to, ...tpl });
  } catch (err) {
    console.error('[email] sendSummaryReadyEmail failed:', err);
  }
}

export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<void> {
  try {
    const tpl = welcomeTemplate(data);
    await sendEmail({ to: data.email, ...tpl });
  } catch (err) {
    console.error('[email] sendWelcomeEmail failed:', err);
  }
}
