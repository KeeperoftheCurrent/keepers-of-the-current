// Input validators. Return { ok, data } on success, { ok:false, errors } on failure.
// Hand-rolled to avoid pulling in zod for a hobby project.

const VALID_RINGS = ['body', 'mind', 'soul'] as const;
type Ring = (typeof VALID_RINGS)[number];

export interface IntakeInput {
  name: string;
  email: string;
  house: string | null;
  rings_pursued: Ring[];
  event_id: string;
  preferred_date: string | null;
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] };

export function validateIntake(raw: unknown): ValidationResult<IntakeInput> {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['Body must be a JSON object.'] };
  }
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) errors.push('Name is required.');
  else if (name.length > 100) errors.push('Name must be 100 characters or fewer.');

  const email = typeof r.email === 'string' ? r.email.trim() : '';
  if (!email) errors.push('Email is required.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push('Email is not a valid address.');
  else if (email.length > 200) errors.push('Email must be 200 characters or fewer.');

  const houseRaw = typeof r.house === 'string' ? r.house.trim() : '';
  const house = houseRaw === '' ? null : houseRaw;
  if (house && house.length > 100) errors.push('House must be 100 characters or fewer.');

  const ringsRaw = r.rings_pursued;
  let rings_pursued: Ring[] = [];
  if (!Array.isArray(ringsRaw) || ringsRaw.length === 0) {
    errors.push('Choose at least one ring to pursue.');
  } else {
    const invalid = ringsRaw.filter(
      (x) => typeof x !== 'string' || !VALID_RINGS.includes(x as Ring)
    );
    if (invalid.length > 0) errors.push('Each ring must be body, mind, or soul.');
    else rings_pursued = Array.from(new Set(ringsRaw as Ring[]));
  }

  const event_id = typeof r.event_id === 'string' ? r.event_id.trim() : '';
  if (!event_id) errors.push('Event is required.');

  const dateRaw = typeof r.preferred_date === 'string' ? r.preferred_date.trim() : '';
  let preferred_date: string | null = null;
  if (dateRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw))
      errors.push('Preferred date must be in YYYY-MM-DD format.');
    else preferred_date = dateRaw;
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: { name, email, house, rings_pursued, event_id, preferred_date },
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Used by the leaderboard endpoint (Phase 3) to parse '1:42' → 102.
// Mirrors v1's parseSeconds at index.html:2325–2332.
export function parseSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/^(\d+):([0-5]?\d)(\.\d+)?$/);
  if (!m) return null;
  const minutes = Number(m[1]);
  const seconds = Number(m[2] + (m[3] ?? ''));
  return minutes * 60 + seconds;
}

export function ringHumanList(rings: Ring[]): string {
  const labels: Record<Ring, string> = {
    body: 'the Ring of Endurance',
    mind: 'the Ring of Focus',
    soul: 'the Ring of Connection',
  };
  const list = rings.map((r) => labels[r]);
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}
