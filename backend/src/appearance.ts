import type { PrismaClient } from '@prisma/client';
import { sqliteInitializer } from './sqlite-compat.js';

export const themeIds = ['classic', 'minimal', 'marketplace', 'dark'] as const;
export type ThemeId = typeof themeIds[number];

// Read old settings without rewriting any existing configuration or application data.
const legacyThemes = new Map<string, ThemeId>([['modern-minimal', 'classic'], ['dark-premium', 'dark'], ['vibrant-commerce', 'marketplace']]);

export function createAppearanceRepository(prisma: PrismaClient) {
  const initialize = sqliteInitializer(prisma);
  return {
    async read(): Promise<ThemeId> {
      await initialize();
      const row = await prisma.siteSetting.findUnique({ where: { key: 'theme' } });
      return themeIds.find((id) => id === row?.value) ?? legacyThemes.get(row?.value ?? '') ?? 'classic';
    },
    async write(theme: ThemeId) {
      await initialize();
      await prisma.siteSetting.upsert({ where: { key: 'theme' }, create: { key: 'theme', value: theme }, update: { value: theme } });
      return theme;
    },
  };
}
