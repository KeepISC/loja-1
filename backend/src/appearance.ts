import type { PrismaClient } from '@prisma/client';

export const themeIds = ['classic', 'minimal', 'marketplace', 'dark'] as const;
export type ThemeId = typeof themeIds[number];

// Read old settings without rewriting any existing configuration or application data.
const legacyThemes = new Map<string, ThemeId>([['modern-minimal', 'classic'], ['dark-premium', 'dark'], ['vibrant-commerce', 'marketplace']]);

export function createAppearanceRepository(prisma: PrismaClient) {
  let ready: Promise<unknown> | undefined;
  const initialize = () => ready ??= prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "SiteSetting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)
  `.catch((error) => { ready = undefined; throw error; });
  return {
    async read(): Promise<ThemeId> {
      await initialize();
      const rows = await prisma.$queryRaw<Array<{ value: string }>>`SELECT "value" FROM "SiteSetting" WHERE "key" = 'theme'`;
      return themeIds.find((id) => id === rows[0]?.value) ?? legacyThemes.get(rows[0]?.value) ?? 'classic';
    },
    async write(theme: ThemeId) {
      await initialize();
      await prisma.$executeRaw`INSERT INTO "SiteSetting" ("key", "value") VALUES ('theme', ${theme})
        ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`;
      return theme;
    },
  };
}
