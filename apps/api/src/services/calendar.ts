/**
 * RFC 5545 iCalendar (.ics) generation for meeting invites.
 *
 * Attaching an ICS file is how email invites delegate timezone rendering to
 * the recipient's mail client / calendar app. DTSTART is in UTC (Z-suffix);
 * Gmail, Outlook, Apple Mail etc. automatically convert to the reader's
 * local timezone when displaying or adding to calendar. This avoids having
 * to guess or store the recipient's timezone on our side.
 */

export interface IcsInviteData {
  meetingId: string;
  title: string;
  description?: string | null;
  scheduledAt: Date;
  durationMinutes?: number;
  organizerEmail: string;
  organizerName?: string;
  /**
   * The envelope sender address (SMTP_FROM). When the organizer's email
   * domain differs from the sending domain, Gmail/Outlook reject the invite
   * with "Unable to load event" unless we advertise the sender via SENT-BY.
   */
  sentByEmail?: string;
  attendeeEmail: string;
  inviteUrl: string;
}

/**
 * Escape a text value per RFC 5545 §3.3.11. Commas, semicolons, and
 * backslashes must be escaped; CRLF sequences become literal `\n`.
 */
function escapeText(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Format a Date as RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ.
 */
function formatIcsUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Fold long content lines at 75 octets per RFC 5545 §3.1. Continuation
 * lines start with a single space. We fold on chars, not bytes — safe as
 * long as the content is ASCII, which ours is after escapeText().
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

/**
 * Build an RFC 5545 VCALENDAR/VEVENT body suitable for attaching as
 * `text/calendar; method=REQUEST`. Duration defaults to 60 minutes because
 * the `meetings` schema does not yet store a duration field.
 */
export function buildInviteIcs(data: IcsInviteData): string {
  const duration = data.durationMinutes ?? 60;
  const end = new Date(data.scheduledAt.getTime() + duration * 60_000);
  const now = new Date();

  // ORGANIZER property. Gmail's smart parser rejects invites where the
  // organizer's mailto domain differs from the sending domain (the classic
  // "Unable to load event" card). When SMTP_FROM lives on a different
  // domain than the host's email, advertise it via SENT-BY so the invite
  // is trusted while RSVPs still route to the real organizer.
  const organizerParams: string[] = [];
  if (data.organizerName) {
    organizerParams.push(`CN=${escapeText(data.organizerName)}`);
  }
  if (
    data.sentByEmail &&
    data.sentByEmail.toLowerCase() !== data.organizerEmail.toLowerCase()
  ) {
    organizerParams.push(`SENT-BY="mailto:${data.sentByEmail}"`);
  }
  const organizer = organizerParams.length > 0
    ? `ORGANIZER;${organizerParams.join(';')}:mailto:${data.organizerEmail}`
    : `ORGANIZER:mailto:${data.organizerEmail}`;

  const description = data.description
    ? `Join: ${data.inviteUrl}\n\n${data.description}`
    : `Join: ${data.inviteUrl}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MojoMeet//Meeting Invite//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${data.meetingId}@mojomeet`,
    `DTSTAMP:${formatIcsUtc(now)}`,
    `DTSTART:${formatIcsUtc(data.scheduledAt)}`,
    `DTEND:${formatIcsUtc(end)}`,
    // SEQUENCE + STATUS + TRANSP are required by Gmail/Outlook to render
    // the RSVP card reliably. Missing them is the most common cause of
    // "Unable to load event" even when the ICS parses.
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    `SUMMARY:${escapeText(data.title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${data.inviteUrl}`,
    organizer,
    // Full ATTENDEE params — Gmail needs CUTYPE/ROLE/PARTSTAT for the
    // "Going? Yes/No/Maybe" UI to populate correctly.
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${data.attendeeEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(foldLine);

  return lines.join('\r\n') + '\r\n';
}
