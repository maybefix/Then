import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const lab = path.resolve('tmp/build-resource-comparison-20261104');
const label = process.argv[2];
assert.ok(['baseline', 'rlib', 'lowmem', 'split-initial', 'split-menu-only', 'final-label', 'final-menu-only'].includes(label));
const installDirectory = path.join(lab, 'installed');
const installer = path.join(lab, label + '-installer.exe');
const profile = path.join(lab, 'webview-profile');
const result = { label, installer, installDirectory, errors: [], check: {} };
let child;
let socket;

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function waitFor(getValue, ms, description) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await getValue();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(description + ' timed out');
}

async function choosePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

try {
  await mkdir(installDirectory, { recursive: true });
  const installArgs = ['/S', '/NS', '/D=' + installDirectory];
  const install = await exec(installer, installArgs, { windowsHide: true, timeout: 120000 });
  result.installExitCode = 0;
  result.installOutput = install.stdout.trim();
  result.installerSha256 = await digest(installer);

  const payload = (await readdir(installDirectory)).filter(name => /\.exe$/i.test(name) && !/^uninstall\.exe$/i.test(name));
  assert.equal(payload.length, 1, 'Expected a single application executable');
  const executable = path.join(installDirectory, payload[0]);
  result.installedExe = executable;
  result.installedExeSha256 = await digest(executable);
  const sevenZip = 'C:/Program Files/7-Zip/7z.exe';
  const extract = spawn(sevenZip, ['x', '-so', '-bse0', installer, payload[0]], { windowsHide: true });
  const extractExit = new Promise((resolve, reject) => {
    extract.on('error', reject);
    extract.on('close', resolve);
  });
  const embeddedHash = createHash('sha256');
  for await (const chunk of extract.stdout) embeddedHash.update(chunk);
  assert.equal(await extractExit, 0);
  assert.equal(embeddedHash.digest('hex'), result.installedExeSha256, 'Installed executable must equal NSIS payload');

  const port = await choosePort();
  child = spawn(executable, [], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port + ' --remote-allow-origins=*',
    },
  });
  const target = await waitFor(async () => {
    if (child.exitCode !== null) throw new Error('Then exited early: ' + child.exitCode);
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(700) });
      return (await response.json()).find(item => item.type === 'page' && item.url.includes('tauri.localhost'));
    } catch {
      return null;
    }
  }, 25000, 'WebView2 debugger');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebView2 connection timed out')), 5000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('WebView2 connection failed')); };
  });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      result.errors.push(message.params.exceptionDetails.text);
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      result.errors.push(message.params.entry.text);
    }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + ' timed out'));
    }, 7000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  };
  await send('Log.enable');
  await send('Runtime.enable');
  result.check.initial = await waitFor(() => evaluate(
    "document.querySelector('.startupPortal') ? 'portal' : document.querySelector('.appFrame') ? 'editor' : null"
  ), 30000, 'Then screen render');
  result.check.native = await evaluate("document.querySelector('[data-native-window=true]') !== null");
  assert.equal(result.check.native, true);
  const entry = await evaluate("document.querySelector('script[type=module][src]')?.src");
  assert.ok(entry?.startsWith('http://tauri.localhost/'));
  const entryInfo = await evaluate('(async () => { const r=await fetch(' + JSON.stringify(entry) + '); const text=await r.text(); return {status:r.status,mime:r.headers.get("content-type"),length:text.length,html:/^\\s*<!doctype html/i.test(text)}; })()');
  assert.equal(entryInfo.status, 200);
  assert.match(entryInfo.mime, /javascript/);
  assert.ok(entryInfo.length > 0 && !entryInfo.html);
  result.check.entry = { url: entry, ...entryInfo };
  if (result.check.initial === 'portal') {
    assert.equal(await evaluate("(() => { const b=[...document.querySelectorAll('.startupPortalActions button')].find(b=>b.textContent.includes('新しい原稿を始める')); if (!b) return false; b.click(); return true; })()"), true);
  }
  const selector = ".topbar .menuButton[aria-label='ファイルメニュー']";
  result.check.menu = await waitFor(() => evaluate('(() => { const b=document.querySelector(' + JSON.stringify(selector) + '); return b ? {text:b.textContent.trim(),icon:!!b.querySelector("svg"),visible:b.getBoundingClientRect().width>0} : null; })()'), 15000, 'file menu button');
  assert.equal(result.check.menu.text, ['split-initial', 'final-label'].includes(label) ? 'メニュー' : '');
  assert.equal(result.check.menu.icon, true);
  assert.equal(result.check.menu.visible, true);
  await evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
  result.check.menuOpened = await waitFor(() => evaluate("document.querySelector('.fileMenuPopover[role=menu]')?.getBoundingClientRect().height > 0"), 5000, 'file menu popup');
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.failure = String(error);
  process.exitCode = 1;
} finally {
  socket?.close();
  if (child?.pid && child.exitCode === null) {
    await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  }
  await writeFile(path.join(lab, label + '.smoke.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
