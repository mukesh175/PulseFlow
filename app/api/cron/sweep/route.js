import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { sweep, DEFAULT_BATCH_SIZE } from '@/lib/scheduler/sweep';
import { createDryRunChannels } from '@/lib/channels';
import { purgeExpiredData } from '@/lib/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The scheduler endpoint.
 *
 * Claims a bounded batch of due enrollments and runs them. The due query is
 * `state = WAITING AND nextRunAt <= now()`, served by the ([state, nextRunAt])
 * index; the database is the only place that knows when work is due.
 *
 * Cadence is currently daily (see vercel.json) — Vercel Hobby allows one cron
 * job at daily granularity and nothing finer. That is why the schema refuses to
 * express a wait shorter than a day. Moving to minute-level sweeps is a change
 * to the cron expression and nothing else: the lease columns are already in the
 * schema and no migration is involved.
 *
 * **Sends are still dry-run.** The real email and discount channels land in
 * phases 4 and 5. Until they exist, the safe implementation is the one wired
 * up here, so a scheduler that runs early cannot reach a real customer.
 */

function authorize(request) {
  // Vercel Cron sends a bearer token; a manual call must present the same one.
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${env.cronSecret}`;
}

export async function GET(request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const channels = createDryRunChannels();

  let scheduler;
  try {
    scheduler = await sweep({ channels, limit: DEFAULT_BATCH_SIZE, now });
  } catch (error) {
    console.error('[pulseflow] sweep failed', error);
    scheduler = { error: error.message };
  }

  // Retention shares this schedule because Hobby allows only one cron job, and
  // a daily deletion pass is exactly what a daily cron is good for.
  let purged;
  try {
    purged = await purgeExpiredData();
  } catch (error) {
    console.error('[pulseflow] retention purge failed', error);
    purged = { error: error.message };
  }

  return NextResponse.json({
    ok: true,
    channels: 'dry-run',
    scheduler,
    purged,
    at: now.toISOString(),
  });
}
