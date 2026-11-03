import { sendSeekerConfirmation, type SeekerEmailContext } from '../functions/lib/email';
import { eventClock } from '../functions/lib/event-time';
import type { Env } from '../functions/lib/db';

export async function runReminders(env: Env) {
  const today = eventClock(env.EVENT_TIME_ZONE).date;
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  const {results: events} = await env.DB.prepare('SELECT id, name, starts_on, ends_on FROM events WHERE active = 1 AND starts_on = ?').bind(tomorrowDate).all<{id:string;name:string;starts_on:string;ends_on:string|null}>();
  let sent = 0, failed = 0, skipped = 0;
  for (const event of events ?? []) {
    // Use the most recent active registration; canceled registrations never receive reminders.
    const {results: registrations} = await env.DB.prepare(`SELECT r.id, r.seeker_id, r.rings_pursued, r.preferred_date, r.preferred_time, r.trial_intentions, s.name, s.email, s.house
      FROM registrations r JOIN seekers s ON s.id = r.seeker_id
      WHERE r.event_id = ? AND r.voided_at IS NULL
      AND r.id = (SELECT r2.id FROM registrations r2 WHERE r2.event_id = r.event_id AND r2.seeker_id = r.seeker_id AND r2.voided_at IS NULL ORDER BY r2.created_at DESC, r2.rowid DESC LIMIT 1)`)
      .bind(event.id).all<{id:string;seeker_id:string;rings_pursued:string;preferred_date:string|null;preferred_time:string|null;trial_intentions:string;name:string;email:string;house:string|null}>();
    for (const registration of registrations ?? []) {
      const now = Math.floor(Date.now()/1000);
      const key = `event-reminder/${event.id}/${registration.seeker_id}`;
      // Atomic claim also prevents overlapping cron/manual runs from sending twice.
      const claimed = await env.DB.prepare(`INSERT INTO reminder_deliveries (delivery_key,seeker_id,event_id,status,attempted_at)
        VALUES (?,?,?,'sending',?) ON CONFLICT(delivery_key) DO UPDATE SET status='sending', attempted_at=excluded.attempted_at, attempts=attempts+1
        WHERE reminder_deliveries.status='failed' OR (reminder_deliveries.status='sending' AND reminder_deliveries.attempted_at < ?)
        RETURNING delivery_key`).bind(key, registration.seeker_id,event.id,now,now-600).first();
      if (!claimed) { skipped++; continue; }
      try {
        const {results: bookings} = await env.DB.prepare(`SELECT b.trial_code,b.start_at,b.end_at FROM bookings b JOIN registrations r ON r.id=b.registration_id
          WHERE b.seeker_id=? AND b.event_id=? AND b.voided_at IS NULL AND r.voided_at IS NULL ORDER BY b.start_at`).bind(registration.seeker_id,event.id).all<{trial_code:string;start_at:string;end_at:string}>();
        const context: SeekerEmailContext = {
          name:registration.name,email:registration.email,house:registration.house,
          rings_pursued:JSON.parse(registration.rings_pursued),
          event_name:event.name,event_starts_on:event.starts_on,event_ends_on:event.ends_on,
          preferred_date:registration.preferred_date,preferred_time:registration.preferred_time,
          submitted_at_iso:new Date().toISOString(),bookings:bookings ?? [],
          trial_intentions:JSON.parse(registration.trial_intentions || '[]'),
          reminder:true,idempotency_key:key,
        };
        await sendSeekerConfirmation(env, context);
        await env.DB.prepare("UPDATE reminder_deliveries SET status='sent', sent_at=? WHERE delivery_key=?").bind(now,key).run();
        sent++;
      } catch {
        await env.DB.prepare("UPDATE reminder_deliveries SET status='failed' WHERE delivery_key=?").bind(key).run();
        console.error('[reminder] Delivery failed', {eventId:event.id, seekerId:registration.seeker_id});
        failed++;
      }
    }
  }
  return {events:events?.length ?? 0,sent,failed,skipped};
}

export default {
  async scheduled(_event: ScheduledController, env: Env) { await runReminders(env); },
  async fetch(request: Request, env: Env & {REMINDER_TRIGGER_SECRET?:string}) {
    if (new URL(request.url).pathname !== '/trigger') return new Response('Not found',{status:404});
    if (!env.REMINDER_TRIGGER_SECRET || request.headers.get('Authorization') !== `Bearer ${env.REMINDER_TRIGGER_SECRET}`) return new Response('Unauthorized',{status:401});
    if (request.method !== 'POST') return new Response('Method not allowed',{status:405});
    return Response.json(await runReminders(env));
  },
};
