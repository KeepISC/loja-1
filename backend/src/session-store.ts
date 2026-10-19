import session from 'express-session';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { sqliteInitializer } from './sqlite-compat.js';

export const sessionHash = (id: string) => createHash('sha256').update(id).digest('hex');
type Callback = (error?: Error | null) => void;

export class DatabaseSessionStore extends session.Store {
  private readonly initialize;
  private nextCleanup = 0;

  constructor(private readonly prisma: PrismaClient) {
    super();
    this.initialize = sqliteInitializer(prisma);
  }

  private expiry(data: session.SessionData) {
    return data.cookie.expires ? new Date(data.cookie.expires) : new Date(Date.now() + 7 * 86400000);
  }

  get(id: string, callback: (error: Error | null, data?: session.SessionData | null) => void) {
    const read = async () => {
      await this.initialize();
      const idHash = sessionHash(id);
      const row = await this.prisma.session.findUnique({ where: { idHash } });
      if (!row) return null;
      if (row.expiresAt.getTime() <= Date.now()) {
        await this.prisma.session.deleteMany({ where: { idHash, expiresAt: { lte: new Date() } } });
        return null;
      }
      const data = JSON.parse(row.data) as session.SessionData;
      data.cookie.expires = row.expiresAt;
      return data;
    };
    void read().then((data) => callback(null, data), () => callback(new Error('Session storage unavailable.')));
  }

  set(id: string, data: session.SessionData, callback: Callback = () => {}) {
    const write = async () => {
      await this.initialize();
      // Explicit fields prevent accidentally persisting a raw session ID.
      const payload = JSON.stringify({ cookie: data.cookie, userRole: data.userRole, customerId: data.customerId, csrfToken: data.csrfToken });
      const row = { data: payload, expiresAt: this.expiry(data) };
      await this.prisma.session.upsert({ where: { idHash: sessionHash(id) }, create: { idHash: sessionHash(id), ...row }, update: row });
      if (Date.now() >= this.nextCleanup) {
        await this.prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
        this.nextCleanup = Date.now() + 60000;
      }
    };
    void write().then(() => callback(), () => callback(new Error('Session storage unavailable.')));
  }

  touch(id: string, data: session.SessionData, callback: Callback = () => {}) {
    const touch = async () => {
      await this.initialize();
      // A stale request must not recreate a deleted/expired session on touch.
      await this.prisma.session.updateMany({ where: { idHash: sessionHash(id), expiresAt: { gt: new Date() } }, data: { expiresAt: this.expiry(data) } });
    };
    void touch().then(() => callback(), () => callback(new Error('Session storage unavailable.')));
  }

  destroy(id: string, callback: Callback = () => {}) {
    const remove = async () => {
      await this.initialize();
      await this.prisma.session.deleteMany({ where: { idHash: sessionHash(id) } });
    };
    void remove().then(() => callback(), () => callback(new Error('Session storage unavailable.')));
  }
}
