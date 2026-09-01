import { loadConfig } from '@everecho/config';
import { seedDemoArchive } from '@everecho/pipeline';
import { createWorkerContext } from './context';

const cfg = loadConfig();
if (cfg.isProduction) {
  console.error('Refusing to seed demonstration data in production.');
  process.exit(1);
}

const ctx = createWorkerContext(cfg);
console.log('Seeding the synthetic demonstration archive…');

try {
  const result = await seedDemoArchive(ctx);
  console.log(`\nArchive ${result.archiveId}`);
  console.log(
    `  ${result.counts.sources} sources, ${result.counts.memories} story cards, ${result.counts.approved} approved`,
  );
  console.log('\nSign in with any of these (all share the same password):\n');
  for (const user of result.users) {
    console.log(`  ${user.role.padEnd(14)} ${user.email.padEnd(32)} ${user.password}`);
  }
  console.log(
    '\nEvery person and story in this archive is invented. No real personal data is included.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await ctx.db.close();
  await ctx.cache.close();
}
