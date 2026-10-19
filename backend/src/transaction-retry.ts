import { setTimeout } from 'node:timers/promises';
import { Prisma } from './database.js';

// InnoDB can abort a competing transaction as a deadlock victim. Retry the whole
// transaction, whose only side effects are committed database writes.
export async function retryTransaction<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 4) throw error;
      await setTimeout(10 * 2 ** attempt + Math.floor(Math.random() * 10));
    }
  }
}
