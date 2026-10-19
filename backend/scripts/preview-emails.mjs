import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppearanceRepository, themeIds } from '../dist/appearance.js';
import { emailPreviewTypes, renderFictionalEmail } from '../dist/email-preview.js';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--theme' || ![...themeIds, 'all'].includes(args[1]))) {
  throw new Error('Usage: npm run preview:emails --workspace backend -- [--theme classic|minimal|marketplace|dark|all]');
}
let selected = args[1];
if (!selected) {
  // Default to the existing store-wide setting. Read settings only, never customers,
  // orders or contacts. Explicit --theme / --theme all is entirely fixture-only.
  const { requireDevelopment } = await import('../dist/config.js');
  requireDevelopment();
  const { PrismaClient } = await import('../dist/database.js');
  const prisma = new PrismaClient();
  try { selected = await createAppearanceRepository(prisma).read(); }
  finally { await prisma.$disconnect(); }
}
const selectedThemes = selected === 'all' ? themeIds : [selected];
const directory = await mkdtemp(path.join(tmpdir(), 'supplier-market-email-preview-'));
const links = [];
for (const theme of selectedThemes) {
  for (const type of emailPreviewTypes) {
    const message = renderFictionalEmail(type, theme);
    for (const [extension, body] of [['html', message.html], ['txt', message.text]]) {
      const name = `${theme}-${type}.${extension}`;
      await writeFile(path.join(directory, name), body, 'utf8');
      links.push(`<li><a href="${name}">${theme} / ${type} (${extension})</a></li>`);
    }
  }
}
const index = path.join(directory, 'index.html');
await writeFile(index, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email theme previews</title></head><body><h1>Supplier Market email previews</h1><p>Fictional data only. No email was sent. Preview selection does not change the storefront.</p><ul>${links.join('')}</ul></body></html>`, 'utf8');
console.log(index);
console.log(`${selectedThemes.length * emailPreviewTypes.length} fictional email previews and plain-text alternatives. No email was sent.`);
