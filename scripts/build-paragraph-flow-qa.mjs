import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Keep the release dist, application identity and installer out of QA builds.
const root = 'artifacts/paragraph-flow-qa-2026-10-10';
const outDir = `${root}/after-dist`;
const result = spawnSync('npm', ['run', 'build', '--', '--outDir', outDir], {
  shell: true, stdio: 'inherit', env: { ...process.env, VITE_QA_PARAGRAPH_FLOW: '1' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(root, { recursive: true });
await writeFile(`${root}/tauri.qa.json`, JSON.stringify({
  productName: 'Then Paragraph Flow QA', identifier: 'local.then.qa.paragraphflow20261010',
  build: { beforeBuildCommand: '', frontendDist: path.relative(path.resolve('src-tauri'), path.resolve(outDir)).replaceAll('\\', '/') },
  bundle: { active: false },
}, null, 2));
console.log(`QA frontend: ${outDir}; isolated Tauri config: ${root}/tauri.qa.json`);
