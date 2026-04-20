/**
 * Pure template functions for transactional emails.
 * Each returns { subject, html, text } — no side effects.
 * All HTML uses inline CSS only (no <style> blocks) for email client compatibility.
 */

// ── HTML escaping ──────────────────────────────────────────────────
const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => ESC[ch]!);
}

/**
 * Strip CR/LF and control chars to prevent header injection (defense-in-depth).
 * Nodemailer sanitizes the subject internally, but we add this layer for safety
 * and to keep our subject lines clean (≤ 255 chars per RFC 2822).
 */
function safeHeader(str: string): string {
  return str.replace(/[\r\n\t\v\f\0]/g, ' ').trim().slice(0, 255);
}

// ── Shared layout wrapper ──────────────────────────────────────────

function wrapLayout(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
  <tr><td align="center" style="padding:24px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:24px 32px;background-color:#18181b;">
        <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">MojoMeet</span>
      </td></tr>
      <tr><td style="padding:32px;">
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 32px;background-color:#f4f4f5;font-size:12px;color:#71717a;text-align:center;">
        &copy; MojoMeet &mdash; Meeting Intelligence
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── CTA button helper ──────────────────────────────────────────────

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="border-radius:6px;background-color:#18181b;">
    <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${esc(label)}</a>
  </td></tr>
</table>`;
}

// ── Template types ─────────────────────────────────────────────────

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface InviteEmailData {
  inviteeEmail: string;
  hostName: string;
  meetingTitle: string;
  inviteUrl: string;
  scheduledAt?: Date;
}

/**
 * Format a Date as a human-readable UTC string for email bodies.
 * Example: "Wed, Apr 22, 2026 · 14:30 UTC".
 *
 * Emails have no runtime to format times in the reader's local timezone,
 * and we don't store per-recipient timezones. We render an unambiguous UTC
 * label in the body and rely on the attached ICS (calendar.ts) to show the
 * reader their local time in their mail client. The CTA link also takes
 * them to the web app where browser-local formatting kicks in.
 */
function formatUtc(d: Date): string {
  return d.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).replace(/,/g, '') + ' UTC';
}

export interface SummaryReadyEmailData {
  recipientName: string;
  meetingTitle: string;
  summaryUrl: string;
}

export interface WelcomeEmailData {
  displayName: string;
  email: string;
}

// ── Templates ──────────────────────────────────────────────────────

export function inviteTemplate(data: InviteEmailData): EmailTemplate {
  const title = esc(data.meetingTitle);
  const host = esc(data.hostName);
  const scheduledUtc = data.scheduledAt ? formatUtc(data.scheduledAt) : null;
  const scheduleLine = scheduledUtc
    ? `<p style="margin:8px 0 4px;font-size:14px;color:#52525b;">Scheduled: <strong>${esc(scheduledUtc)}</strong></p>
       <p style="margin:0 0 8px;font-size:12px;color:#a1a1aa;">An invite is attached — open it to see the time in your local timezone, or click below to view in the web app.</p>`
    : '';

  const html = wrapLayout(`
    <h1 style="margin:0 0 16px;font-size:20px;color:#18181b;">You're invited to a meeting</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#3f3f46;"><strong>${host}</strong> has invited you to:</p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:600;color:#18181b;">${title}</p>
    ${scheduleLine}
    ${ctaButton('Join Meeting', data.inviteUrl)}
    <p style="margin:0;font-size:12px;color:#a1a1aa;">Or copy this link: ${esc(data.inviteUrl)}</p>
  `);

  const text = [
    `You're invited to a meeting`,
    ``,
    `${data.hostName} has invited you to: ${data.meetingTitle}`,
    scheduledUtc ? `Scheduled: ${scheduledUtc} (see attached invite for local time)` : '',
    ``,
    `Join here: ${data.inviteUrl}`,
  ].filter(Boolean).join('\n');

  return {
    subject: safeHeader(`You're invited to: ${data.meetingTitle}`),
    html,
    text,
  };
}

export function summaryReadyTemplate(data: SummaryReadyEmailData): EmailTemplate {
  const title = esc(data.meetingTitle);
  const name = esc(data.recipientName);

  const html = wrapLayout(`
    <h1 style="margin:0 0 16px;font-size:20px;color:#18181b;">Meeting summary ready</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#3f3f46;">Hi ${name},</p>
    <p style="margin:0 0 4px;font-size:14px;color:#3f3f46;">The summary for <strong>${title}</strong> is now available.</p>
    ${ctaButton('View Summary', data.summaryUrl)}
    <p style="margin:0;font-size:12px;color:#a1a1aa;">Or copy this link: ${esc(data.summaryUrl)}</p>
  `);

  const text = [
    `Meeting summary ready`,
    ``,
    `Hi ${data.recipientName},`,
    `The summary for "${data.meetingTitle}" is now available.`,
    ``,
    `View it here: ${data.summaryUrl}`,
  ].join('\n');

  return {
    subject: safeHeader(`Meeting summary ready: ${data.meetingTitle}`),
    html,
    text,
  };
}

export function welcomeTemplate(data: WelcomeEmailData): EmailTemplate {
  const name = esc(data.displayName);

  const html = wrapLayout(`
    <h1 style="margin:0 0 16px;font-size:20px;color:#18181b;">Welcome to MojoMeet</h1>
    <p style="margin:0 0 8px;font-size:14px;color:#3f3f46;">Hi ${name},</p>
    <p style="margin:0 0 8px;font-size:14px;color:#3f3f46;">Your account is ready. You can now create meetings, invite participants, and get AI-powered insights in real time.</p>
    <p style="margin:0;font-size:14px;color:#3f3f46;">Get started by creating your first meeting.</p>
  `);

  const text = [
    `Welcome to MojoMeet`,
    ``,
    `Hi ${data.displayName},`,
    `Your account is ready. You can now create meetings, invite participants, and get AI-powered insights in real time.`,
    ``,
    `Get started by creating your first meeting.`,
  ].join('\n');

  return {
    subject: 'Welcome to MojoMeet',
    html,
    text,
  };
}
