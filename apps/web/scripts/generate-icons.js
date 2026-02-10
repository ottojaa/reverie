/**
 * Generates icons-data.ts from the lucide repo (name, categories, tags).
 * Run from apps/web: node scripts/generate-icons.js
 * Requires: pnpm add -D simple-git (in apps/web)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import simpleGit from 'simple-git';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, 'lucide-temp');
const OUT_PATH = path.join(__dirname, '..', 'src', 'components', 'ui', 'icons-data.ts');

async function main() {
    console.log('Cloning Lucide repo...');

    const git = simpleGit();

    if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }

    await git.clone('https://github.com/lucide-icons/lucide.git', TEMP_DIR, ['--depth', '1']);

    console.log('Repo cloned. Reading icons...');

    const iconsJson = fs.readdirSync(path.join(TEMP_DIR, 'icons'));
    const icons = iconsJson
        .filter((icon) => icon.endsWith('.json'))
        .map((icon) => {
            const iconData = JSON.parse(
                fs.readFileSync(path.join(TEMP_DIR, 'icons', icon), 'utf-8')
            );
            return {
                name: icon.replace('.json', ''),
                tags: iconData.tags ?? [],
                categories: iconData.categories ?? [],
            };
        });

    const iconsDataTs = `export const iconsData = [
  ${icons
      .map(
          (icon) =>
              `{
    "name": "${icon.name}",
    "categories": [${(icon.categories ?? []).map((c) => `"${c}"`).join(',')}],
    "tags": [${(icon.tags ?? []).map((t) => `"${t.replace(/"/g, '\\"')}"`).join(',')}]
  }`
      )
      .join(',\n  ')}
] as const;

export type SectionIconName = (typeof iconsData)[number]['name'];
`;

    fs.writeFileSync(OUT_PATH, iconsDataTs, 'utf-8');

    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('Done. Wrote', OUT_PATH);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
