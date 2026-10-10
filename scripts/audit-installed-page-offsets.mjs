// Exercise the installed executable unchanged. Temporarily preserve/replace its
// profile state so no user manuscript is opened; restore bytes after shutdown.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const artifactRoot = 'artifacts/paragraph-flow-qa-2026-10-10';
const executable = 'C:/Users/uest/AppData/Local/Then/Then.exe';
const stateRoot = 'C:/Users/uest/AppData/Roaming/local.then';
const preserved = new Map();
await mkdir(`${artifactRoot}/installed-state-backup`, { recursive: true });
for (const name of ['app-state.json', 'main-window-state.json']) {
  try {
    const bytes = await readFile(path.join(stateRoot, name));
    preserved.set(name, bytes);
    await writeFile(`${artifactRoot}/installed-state-backup/${name}`, bytes);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function exposeInstalledPageBreaks({ page, evaluate }) {
  const mainUrl = await evaluate("document.querySelector('script[type=module]').src");
  const scripts = [];
  const previousEvents = page.onEvent;
  page.onEvent = message => {
    previousEvents?.(message);
    if (message.method === 'Debugger.scriptParsed') scripts.push(message.params);
  };
  await page.send('Debugger.enable');
  const script = scripts.find(script => script.url === mainUrl);
  if (!script) throw new Error('Installed main script not found');
  const { scriptSource } = await page.send('Debugger.getScriptSource', { scriptId: script.scriptId });
  const matches = [...scriptSource.matchAll(/const ([\w$]+)=([\w$]+)\.current,([\w$]+)=Math\.max\(1,\1\.pages\.length\)/g)];
  if (matches.length !== 1) throw new Error(`Expected one page-break ref location; found ${matches.length}`);
  const match = matches[0];
  const prefix = scriptSource.slice(0, match.index);
  const lineNumber = prefix.split('\n').length - 1;
  const columnNumber = prefix.length - (prefix.lastIndexOf('\n') + 1);
  const { breakpointId } = await page.send('Debugger.setBreakpoint', { location: { scriptId: script.scriptId, lineNumber, columnNumber } });
  const metadata = { mainUrl, scriptSha256: (await import('node:crypto')).createHash('sha256').update(scriptSource).digest('hex'),
    breakpointLocation: { lineNumber, columnNumber }, originalPageBreakRef: match[2], exposed: false };
  page.onEvent = message => {
    previousEvents?.(message);
    if (message.method !== 'Debugger.paused') return;
    void (async () => {
      try {
        const response = await page.send('Debugger.evaluateOnCallFrame', {
          callFrameId: message.params.callFrames[0].callFrameId,
          expression: `document.querySelector('.ProseMirror').__pageBreaksQA=()=>({breaks:${match[2]}.current});true`,
          returnByValue: true,
        });
        if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
        metadata.exposed = true;
        await page.send('Debugger.removeBreakpoint', { breakpointId });
      } catch (error) { metadata.error = String(error); }
      finally { await page.send('Debugger.resume'); await page.send('Debugger.disable'); page.onEvent = previousEvents; }
    })();
  };
  await evaluate(`window.__installedAuditMetadata=${JSON.stringify(metadata)};true`);
  return metadata;
}

let harness = await readFile(new URL('./benchmark-typing.mjs', import.meta.url), 'utf8');
let audit = await readFile(new URL('./audit-visual-line-index-browser.mjs', import.meta.url), 'utf8');
audit = audit.slice(0, audit.indexOf("const source=await readFile"));
harness = harness.replace('console.error(error);', 'console.error(error.message ?? String(error));');
harness = harness.replace(/  summary\.cpuPerKey = \{[\s\S]*?\n  \};/, '  // Multi-operation diagnosis has no per-key CPU statistic.');
harness = harness.replace('  await evaluate("localStorage.clear(); location.reload(); 1");', '  // Preserve installed localStorage; use an isolated WebView2 data folder.');
harness = harness.replace('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:', 'WEBVIEW2_USER_DATA_FOLDER: profileDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:');
harness = harness.replace('  browser.kill();', '  const stopped = new Promise(resolve => browser.once("exit", resolve));\n  browser.kill();\n  await Promise.race([stopped, sleep(5000)]);');
harness = harness.replace('process.exit(exitCode);', 'process.exitCode = exitCode;');
harness = harness.replace('"./lib/typewriter-benchmark.mjs"', JSON.stringify(new URL('./lib/typewriter-benchmark.mjs', import.meta.url).href));
const marker = 'await runTypewriterBenchmark({ page, evaluate, samples: SAMPLES, scenario: option("scenario", "typing") })';
if (!harness.includes(marker)) throw new Error('Benchmark harness changed');
harness = harness.replace(marker, 'await (async()=>{const metadata=await exposeInstalledPageBreaks({page,evaluate});try{return await auditVisualIndex({page,evaluate});}finally{await writeFile("artifacts/paragraph-flow-qa-2026-10-10/installed-script-metadata.json",JSON.stringify(metadata,null,2));}})()');
const { build } = await import('esbuild');
const ts = (await import('typescript')).default;
const visualSource = await readFile(new URL('../src/editor/visualLineLayout.ts', import.meta.url), 'utf8');
const oracle = ts.transpileModule(visualSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/\bexport\s+/g, '');
const pageOracle = (await build({ entryPoints: ['src/editor/pageBreaks.ts'], bundle: true, format: 'iife', globalName: '__pageBreaksOracle', write: false })).outputFiles[0].text;
const executableSha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
await writeFile(`${artifactRoot}/installed-binary-metadata.json`, JSON.stringify({ executable, executableSha256, testProfile: 'Temporarily empty app state; original profile restored byte-for-byte after process exits', executableModified: false }, null, 2));
try {
  await writeFile(path.join(stateRoot, 'app-state.json'), JSON.stringify({ settings: { skipStartupPortal: true } }));
  const combined = `const ORACLE=${JSON.stringify(oracle)},QA_PAGE_ORACLE=${JSON.stringify(pageOracle)};\n${exposeInstalledPageBreaks.toString()}\n${audit.replace(/^import .*;\r?\n/gm, '')}\n${harness}`;
  await import('data:text/javascript;base64,' + Buffer.from(combined).toString('base64'));
} finally {
  const restoration = [];
  for (const name of ['app-state.json', 'main-window-state.json']) {
    const target = path.join(stateRoot, name);
    if (preserved.has(name)) await writeFile(target, preserved.get(name));
    else await rm(target, { force: true });
    const restored = preserved.has(name) ? (await readFile(target)).equals(preserved.get(name)) : true;
    restoration.push({ name, restoredByteForByte: restored });
    if (!restored) throw new Error('Installed state restoration failed: ' + name);
  }
  await writeFile(`${artifactRoot}/installed-state-restoration.json`, JSON.stringify({ executableSha256, restoration }, null, 2));
  console.log(JSON.stringify({ installedStateRestored: restoration.every(item => item.restoredByteForByte) }));
}
