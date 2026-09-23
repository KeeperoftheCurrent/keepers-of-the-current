// Bookings are wall-clock times at Hynafol, not UTC timestamps. Use the event
// calendar's zone so a gathering doesn't disappear at midnight UTC in Texas.
export function eventClock(timeZone = 'America/Chicago', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  return { date, localDateTime: `${date}T${part('hour')}:${part('minute')}`, timeZone };
}
