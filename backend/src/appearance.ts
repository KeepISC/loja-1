import type { PrismaClient } from '@prisma/client';

export const themeIds = ['modern-minimal', 'dark-premium', 'vibrant-commerce'] as const;
export type ThemeId = typeof themeIds[number];

export function createAppearanceRepository(prisma: PrismaClient) {
  let ready: Promise<unknown> | undefined;
  const initialize = () => ready ??= prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "SiteSetting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)
  `.catch((error) => { ready = undefined; throw error; });
  return {
    async read(): Promise<ThemeId> {
      await initialize();
      const rows = await prisma.$queryRaw<Array<{ value: string }>>`SELECT "value" FROM "SiteSetting" WHERE "key" = 'theme'`;
      return themeIds.find((id) => id === rows[0]?.value) ?? 'modern-minimal';
    },
    async write(theme: ThemeId) {
      await initialize();
      await prisma.$executeRaw`INSERT INTO "SiteSetting" ("key", "value") VALUES ('theme', ${theme})
        ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`;
      return theme;
    },
  };
}
