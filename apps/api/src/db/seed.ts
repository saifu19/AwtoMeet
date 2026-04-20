import 'dotenv/config';
import { db, pool } from './client.js';
import { usageLimits } from './schema.js';
import { sql } from 'drizzle-orm';

async function main() {
  const existing = await db
    .select({ id: usageLimits.id })
    .from(usageLimits)
    .where(sql`${usageLimits.userId} IS NULL AND ${usageLimits.orgId} IS NULL`);

  if (existing.length === 0) {
    await db.insert(usageLimits).values({
      userId: null,
      orgId: null,
      maxMeetingMinutesPerMonth: null,
      maxCostUsdPerMonth: null,
      maxAgents: null,
      updatedAt: new Date(),
    });
    console.log('Inserted global default usage_limits row.');
  } else {
    console.log('Global default usage_limits row already exists; skipping.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
