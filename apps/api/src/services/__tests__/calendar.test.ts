import { describe, it, expect } from 'vitest';
import { buildInviteIcs } from '../calendar.js';

/**
 * RFC 5545 §3.1 unfolding: a long content line is split at 75 octets with
 * `CRLF <whitespace>` as continuation. Parsers unfold before interpreting.
 * Our assertions should test the logical content, not the transport form.
 */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

describe('buildInviteIcs', () => {
  const base = {
    meetingId: '01HXXXXXXXXXXXXXXXXXXXXXXX',
    title: 'Sales Discovery',
    scheduledAt: new Date('2026-04-22T14:30:00Z'),
    organizerEmail: 'host@example.com',
    organizerName: 'Host Name',
    attendeeEmail: 'guest@example.com',
    inviteUrl: 'https://mojomeet.app/invites/abc',
  };

  it('emits a syntactically valid VCALENDAR/VEVENT block', () => {
    const ics = buildInviteIcs(base);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('uses CRLF line endings per RFC 5545', () => {
    const ics = buildInviteIcs(base);
    expect(ics).toMatch(/\r\n/);
    expect(ics.split('\r\n').length).toBeGreaterThan(5);
  });

  it('emits DTSTART in UTC Z form', () => {
    const ics = buildInviteIcs(base);
    expect(ics).toContain('DTSTART:20260422T143000Z');
  });

  it('defaults duration to 60 minutes', () => {
    const ics = buildInviteIcs(base);
    expect(ics).toContain('DTEND:20260422T153000Z');
  });

  it('honours custom duration', () => {
    const ics = buildInviteIcs({ ...base, durationMinutes: 30 });
    expect(ics).toContain('DTEND:20260422T150000Z');
  });

  it('includes UID, organizer, and attendee', () => {
    const ics = unfold(buildInviteIcs(base));
    expect(ics).toContain(`UID:${base.meetingId}@mojomeet`);
    expect(ics).toContain('ORGANIZER;CN=Host Name:mailto:host@example.com');
    expect(ics).toContain('mailto:guest@example.com');
  });

  it('escapes RFC 5545 special chars in text fields', () => {
    const ics = buildInviteIcs({
      ...base,
      title: 'Call, with; backslash\\ and\nnewline',
    });
    expect(ics).toContain('SUMMARY:Call\\, with\\; backslash\\\\ and\\nnewline');
  });

  it('includes the join URL in DESCRIPTION and URL properties', () => {
    const ics = buildInviteIcs(base);
    expect(ics).toContain(`URL:${base.inviteUrl}`);
    expect(ics).toContain(`Join: ${base.inviteUrl}`);
  });

  it('emits SEQUENCE, STATUS, and TRANSP required by Gmail/Outlook', () => {
    const ics = buildInviteIcs(base);
    expect(ics).toContain('SEQUENCE:0');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('TRANSP:OPAQUE');
  });

  it('emits full ATTENDEE params for RSVP UI', () => {
    const ics = unfold(buildInviteIcs(base));
    expect(ics).toContain(
      'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@example.com',
    );
  });

  it('adds SENT-BY to ORGANIZER when sender domain differs', () => {
    const ics = unfold(
      buildInviteIcs({ ...base, sentByEmail: 'noreply@mojomosaic.com' }),
    );
    expect(ics).toContain('SENT-BY="mailto:noreply@mojomosaic.com"');
    expect(ics).toContain('mailto:host@example.com');
  });

  it('omits SENT-BY when sender matches organizer', () => {
    const ics = buildInviteIcs({
      ...base,
      sentByEmail: 'host@example.com',
    });
    expect(ics).not.toContain('SENT-BY');
  });

  it('is case-insensitive when comparing sender to organizer', () => {
    const ics = buildInviteIcs({
      ...base,
      organizerEmail: 'Host@Example.com',
      sentByEmail: 'host@example.com',
    });
    expect(ics).not.toContain('SENT-BY');
  });
});
