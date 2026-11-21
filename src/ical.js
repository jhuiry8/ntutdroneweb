// iCalendar (RFC 5545) feed builder. Entries are plain objects so events and meetings share it:
//   { uid, title, description, location, url, startsAt (ISO) | date ('YYYY-MM-DD' all-day), endsAt?, updatedAt? }
const CRLF = '\r\n';

export function icsEscape(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

// Content lines are limited to 75 octets; continuation lines start with one space. Never split a UTF-8 character.
export function foldLine(line) {
    const encoder = new TextEncoder();
    if (encoder.encode(line).length <= 75) return line;
    const parts = [];
    let current = '';
    let size = 0;
    let limit = 75;
    for (const char of line) {
        const bytes = encoder.encode(char).length;
        if (size + bytes > limit) { parts.push(current); current = ''; size = 0; limit = 74; }
        current += char; size += bytes;
    }
    parts.push(current);
    return parts.join(CRLF + ' ');
}

const utc = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateValue = date => date.replace(/-/g, '');
function nextDay(date) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

export function buildIcs(entries, { name, now = new Date().toISOString(), defaultMinutes = 120 } = {}) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NTUT Drone Club//Calendar//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        `X-WR-CALNAME:${icsEscape(name || 'NTUT Drone Club')}`, 'X-WR-TIMEZONE:Asia/Taipei'];
    for (const entry of entries) {
        lines.push('BEGIN:VEVENT', `UID:${icsEscape(entry.uid)}`, `DTSTAMP:${utc(now)}`);
        if (entry.date && !entry.startsAt) {
            lines.push(`DTSTART;VALUE=DATE:${dateValue(entry.date)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(entry.date))}`);
        } else {
            const end = entry.endsAt || new Date(Date.parse(entry.startsAt) + defaultMinutes * 60000).toISOString();
            lines.push(`DTSTART:${utc(entry.startsAt)}`, `DTEND:${utc(end)}`);
        }
        lines.push(`SUMMARY:${icsEscape(entry.title)}`);
        if (entry.description) lines.push(`DESCRIPTION:${icsEscape(entry.description)}`);
        if (entry.location) lines.push(`LOCATION:${icsEscape(entry.location)}`);
        if (entry.url) lines.push(`URL:${entry.url}`);
        if (entry.updatedAt) lines.push(`LAST-MODIFIED:${utc(entry.updatedAt)}`);
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join(CRLF) + CRLF;
}
