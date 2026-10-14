// Google Calendar / ICS helpers (all-day study-plan events).

function ymdCompact(iso: string): string {
  return iso.replace(/-/g, '');
}
function nextDayCompact(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}${m < 10 ? '0' + m : m}${day < 10 ? '0' + day : day}`;
}
export function googleCalLink(title: string, iso: string, details: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${ymdCompact(iso)}/${nextDayCompact(iso)}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
function icsEscape(s: string): string {
  return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
export function buildICS(events: { title: string; iso: string; details: string }[], stamp: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tomurized//StudyPlan//HE', 'CALSCALE:GREGORIAN'];
  events.forEach((e, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:tomurized-${i}-${ymdCompact(e.iso)}@tomurized`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymdCompact(e.iso)}`,
      `DTEND;VALUE=DATE:${nextDayCompact(e.iso)}`,
      `SUMMARY:${icsEscape(e.title)}`,
      `DESCRIPTION:${icsEscape(e.details)}`,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
