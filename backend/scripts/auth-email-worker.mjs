import '../dist/config.js';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import { PrismaClient } from '../dist/database.js';
import { authenticationEmail } from '../dist/auth-email.js';
import { readAuthEmailConfig } from '../dist/auth-email-transport.js';

let prisma;
try {
  if (process.argv.length !== 3 || !['--once', '--watch'].includes(process.argv[2])) throw new Error();
  const config = readAuthEmailConfig();
  if (config.mode === 'preview') {
    console.log('Preview transport stores messages locally. No SMTP worker is needed.');
  } else {
    // Resolution does not connect. Fail before consuming attempts if dependencies are missing.
    createRequire(import.meta.url).resolve('nodemailer');
    prisma = new PrismaClient();
    const service = authenticationEmail(prisma, { config });
    let stopped = false;
    process.once('SIGINT', () => { stopped = true; });
    process.once('SIGTERM', () => { stopped = true; });
    do {
      const counts = { SENT: 0, FAILED: 0, CANCELLED: 0, SKIPPED: 0 };
      for (const id of await service.pending()) {
        if (stopped) break;
        const result = await service.deliver(id);
        if (result in counts) counts[result]++;
      }
      // Counts only: never addresses, bodies, message IDs, provider errors or tokens.
      if (Object.values(counts).some(Boolean)) console.log(JSON.stringify(counts));
      if (process.argv[2] === '--once') { if (counts.FAILED) process.exitCode = 1; break; }
      if (!stopped) await setTimeout(1000);
    } while (!stopped);
  }
} catch {
  console.error('Authentication email worker failed. Check local configuration, database availability and dependencies. Private details suppressed.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
