import { describe, it, expect } from 'vitest';
import {
  inviteTemplate,
  summaryReadyTemplate,
  welcomeTemplate,
} from '../email-templates.js';

describe('inviteTemplate', () => {
  const base = {
    inviteeEmail: 'alice@example.com',
    hostName: 'bob@example.com',
    meetingTitle: 'Sales Discovery Call',
    inviteUrl: 'http://localhost:5173/invites/abc123',
  };

  it('returns subject, html, and text', () => {
    const tpl = inviteTemplate(base);
    expect(tpl.subject).toBe("You're invited to: Sales Discovery Call");
    expect(tpl.html).toContain('Sales Discovery Call');
    expect(tpl.text).toContain('Sales Discovery Call');
  });

  it('includes CTA link in html', () => {
    const tpl = inviteTemplate(base);
    expect(tpl.html).toContain('href="http://localhost:5173/invites/abc123"');
  });

  it('includes invite URL in plain text', () => {
    const tpl = inviteTemplate(base);
    expect(tpl.text).toContain('http://localhost:5173/invites/abc123');
  });

  it('includes scheduled time when provided', () => {
    const tpl = inviteTemplate({ ...base, scheduledAt: '2026-04-15T10:00:00Z' });
    expect(tpl.html).toContain('2026-04-15T10:00:00Z');
    expect(tpl.text).toContain('2026-04-15T10:00:00Z');
  });

  it('omits scheduled line when not provided', () => {
    const tpl = inviteTemplate(base);
    expect(tpl.html).not.toContain('Scheduled:');
  });

  it('uses only inline CSS (no <style> blocks)', () => {
    const tpl = inviteTemplate(base);
    expect(tpl.html).not.toMatch(/<style[\s>]/i);
  });

  it('HTML-escapes user-provided strings', () => {
    const tpl = inviteTemplate({
      ...base,
      meetingTitle: '<script>alert("xss")</script>',
      hostName: 'Eve <evil@hack.com>',
    });
    expect(tpl.html).not.toContain('<script>');
    expect(tpl.html).toContain('&lt;script&gt;');
    expect(tpl.html).toContain('&lt;evil@hack.com&gt;');
  });

  it('produces non-empty text fallback', () => {
    const tpl = inviteTemplate(base);
    expect(tpl.text.length).toBeGreaterThan(0);
  });
});

describe('summaryReadyTemplate', () => {
  const base = {
    recipientName: 'Alice',
    meetingTitle: 'Sprint Retro',
    summaryUrl: 'http://localhost:5173/meetings/abc/summary',
  };

  it('returns subject, html, and text', () => {
    const tpl = summaryReadyTemplate(base);
    expect(tpl.subject).toBe('Meeting summary ready: Sprint Retro');
    expect(tpl.html).toContain('Sprint Retro');
    expect(tpl.text).toContain('Sprint Retro');
  });

  it('includes CTA link in html', () => {
    const tpl = summaryReadyTemplate(base);
    expect(tpl.html).toContain('href="http://localhost:5173/meetings/abc/summary"');
  });

  it('uses only inline CSS', () => {
    const tpl = summaryReadyTemplate(base);
    expect(tpl.html).not.toMatch(/<style[\s>]/i);
  });

  it('HTML-escapes user-provided strings', () => {
    const tpl = summaryReadyTemplate({
      ...base,
      meetingTitle: '<img src=x onerror=alert(1)>',
    });
    expect(tpl.html).not.toContain('<img');
    expect(tpl.html).toContain('&lt;img');
  });

  it('produces non-empty text fallback', () => {
    const tpl = summaryReadyTemplate(base);
    expect(tpl.text.length).toBeGreaterThan(0);
  });
});

describe('welcomeTemplate', () => {
  const base = {
    displayName: 'Alice Johnson',
    email: 'alice@example.com',
  };

  it('returns subject, html, and text', () => {
    const tpl = welcomeTemplate(base);
    expect(tpl.subject).toBe('Welcome to MojoMeet');
    expect(tpl.html).toContain('Alice Johnson');
    expect(tpl.text).toContain('Alice Johnson');
  });

  it('uses only inline CSS', () => {
    const tpl = welcomeTemplate(base);
    expect(tpl.html).not.toMatch(/<style[\s>]/i);
  });

  it('HTML-escapes user-provided strings', () => {
    const tpl = welcomeTemplate({
      ...base,
      displayName: '<b>Bold Name</b>',
    });
    expect(tpl.html).not.toContain('<b>Bold');
    expect(tpl.html).toContain('&lt;b&gt;');
  });

  it('produces non-empty text fallback', () => {
    const tpl = welcomeTemplate(base);
    expect(tpl.text.length).toBeGreaterThan(0);
  });
});
