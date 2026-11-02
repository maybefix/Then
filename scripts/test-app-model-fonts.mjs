// App.tsxから移したモデル補助と、フォント一覧の実際のReactライフサイクルを確認する。
// 元の補助関数で期待値を確認済み。手順はdocs/APP_MODEL_FONTS_SEPARATION_PLAN.md。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import path from 'node:path';
const root = process.cwd();
const scratch = path.join(root, 'tmp/app-model-fonts-tests');
await mkdir(scratch, { recursive: true });
const realReactUrl = pathToFileURL(createRequire(import.meta.url).resolve('react')).href;
const source = [
    'export { createFontOptions, fallbackFontOptions, createSystemFontLoader } from "./src/systemFonts";',
    'export { useSystemFonts } from "./src/useSystemFonts";',
    'export { createEmptyDocumentTab, withoutEmptyTabs, insertTabAfter, CLOSED_DOCUMENT_TAB_LIMIT, isClosedTabInWorkspace, createFileDocumentTab } from "./src/editor/documentTabState";',
    'export { countDisplayCharacters } from "./src/editor/displayCharacterCount";',
    'export { referenceCardKey, upsertRecentReference, upsertRecentReferences, nextReferenceZIndex } from "./src/referenceCardModel";',
    'export { nextCanvasPlacement } from "./src/canvasPlacement";',
].join('\n');
const result = await build({ stdin: { contents: source, loader: 'ts', resolveDir: root, sourcefile: 'app-model-fonts-tests.ts' }, bundle: true, format: 'esm', platform: 'node', write: false, external: [realReactUrl], define: { 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'fake-font-ipc', setup(b) {
                b.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'font-ipc', namespace: 'fake' }));
                b.onLoad({ filter: /^font-ipc$/, namespace: 'fake' }, () => ({ contents: 'export const invoke = (...args) => globalThis.__fontInvoke(...args);', loader: 'js' }));
                b.onResolve({ filter: /^react$/ }, () => ({ path: 'react-observed', namespace: 'fake' }));
                b.onLoad({ filter: /^react-observed$/, namespace: 'fake' }, () => ({ contents: 'import { useEffect, useState as realUseState } from ' + JSON.stringify(realReactUrl) + '; export { useEffect }; export function useState(initial) { const [value,set] = realUseState(initial); return [value, next => { globalThis.__fontStateWrites += 1; set(next); }]; }', loader: 'js' }));
            } }] });
const compiled = path.join(scratch, 'models-' + process.pid + '.mjs');
await writeFile(compiled, result.outputFiles[0].text);
const api = await import(pathToFileURL(compiled).href).finally(() => unlink(compiled));
const m = { ...api, loadSystemFonts: api.createSystemFontLoader(() => '__TAURI_INTERNALS__' in window) };
const checked = [];
const check = async (name, fn) => { await fn(); checked.push(name); };
const tab = (id) => m.createFileDocumentTab({ path: 'C:/qa/' + id + '.txt', name: id + '.txt', content: id });
await check('empty tab / timestamp / hidden / saved', () => {
    const before = Date.now;
    Date.now = () => 123;
    try {
        const t = m.createEmptyDocumentTab();
        assert.equal(t.id, 'empty-123');
        assert.equal(t.documentKey, t.id);
        assert.equal(t.kind, 'empty');
        assert.equal(t.name, '');
        assert.equal(t.saveStatus, 'saved');
        assert.equal(t.markdown, '');
    }
    finally {
        Date.now = before;
    }
});
await check('file tab preserves raw content and metadata', () => { const t = m.createFileDocumentTab({ path: 'C:/qa/a.md', name: 'a.md', content: '---\r\ntitle: A\r\n---\r\n本文', fileId: 'f', contentHash: 'h' }); assert.equal(t.markdown, t.savedMarkdown); assert.equal(t.fileId, 'f'); assert.equal(t.contentHash, 'h'); assert.equal(t.editorRevision, null); assert.equal(t.viewportState, null); assert.equal(t.saveStatus, 'saved'); });
await check('insert removes empty tabs / after active / missing appends / immutable', () => { const a = tab('a'), b = tab('b'), n = tab('n'), e = m.createEmptyDocumentTab(), input = [e, a, b]; assert.deepEqual(m.insertTabAfter(input, n, a.id), [a, n, b]); assert.deepEqual(m.insertTabAfter(input, n, 'missing'), [a, b, n]); assert.deepEqual(m.insertTabAfter(input, n, null), [a, b, n]); assert.deepEqual(input, [e, a, b]); assert.deepEqual(m.withoutEmptyTabs(input), [a, b]); assert.equal(m.CLOSED_DOCUMENT_TAB_LIMIT, 10); });
await check('closed tab workspace path normalization / null matching', () => { const r = { workspacePath: 'C:\\QA\\Work', path: 'a', index: 0, viewportState: null }; assert.equal(m.isClosedTabInWorkspace(r, 'c:/qa/work'), true); assert.equal(m.isClosedTabInWorkspace(r, null), false); assert.equal(m.isClosedTabInWorkspace({ ...r, workspacePath: null }, null), true); });
await check('selected character count / surrogate / whitespace / combining marks', () => { assert.equal(m.countDisplayCharacters('あ 　\n𠮷', true), 5); assert.equal(m.countDisplayCharacters('あ 　\n𠮷', false), 2); assert.equal(m.countDisplayCharacters('か\u3099', false), 2); assert.equal(m.countDisplayCharacters('', false), 0); });
const layout = { version: 3, name: 'default', cards: [], recent: [], ideaThreads: [] };
const file = (name, scope = 'project') => ({ sourcePath: 'C:/qa/' + name, scope, name, kind: 'text' });
await check('reference key scope and path normalization', () => { assert.equal(m.referenceCardKey({ sourcePath: 'C:\\QA\\A.txt', scope: 'project' }), 'project:c:/qa/a.txt'); assert.notEqual(m.referenceCardKey(file('a', 'project')), m.referenceCardKey(file('a', 'profile'))); });
await check('recent reference replacement / limit / immutable', () => {
    const old = file('a');
    const first = { ...layout, recent: [old, file('b')] };
    const update = { ...file('A'), name: 'updated' };
    const next = m.upsertRecentReference(first, update);
    assert.deepEqual(next.recent, [update, file('b')]);
    assert.deepEqual(first.recent, [old, file('b')]);
    let capped = layout;
    for (let i = 0; i < 35; i++)
        capped = m.upsertRecentReference(capped, file(String(i)));
    assert.equal(capped.recent.length, 30);
    assert.equal(capped.recent[0].name, '34');
    assert.equal(capped.recent.at(-1).name, '5');
});
await check('recent multi insert reverses input order', () => { assert.deepEqual(m.upsertRecentReferences(layout, [file('a'), file('b')]).recent, [file('b'), file('a')]); });
await check('z index base / cap / pin separation', () => { assert.equal(m.nextReferenceZIndex([], false), 1); assert.equal(m.nextReferenceZIndex([], true), 10001); assert.equal(m.nextReferenceZIndex([{ pinned: false, zIndex: 9999 }, { pinned: true, zIndex: 20000 }], false), 9999); assert.equal(m.nextReferenceZIndex([{ pinned: false, zIndex: 99999 }, { pinned: true, zIndex: 20000 }], true), 20001); });
await check('canvas placement default / ignore non-text / right edge / tie', () => { const node = (id, x, y, width, type = 'text') => ({ id, x, y, width, height: 100, type }); assert.deepEqual(m.nextCanvasPlacement({ nodes: [] }), { x: 120, y: 120 }); assert.deepEqual(m.nextCanvasPlacement({ nodes: [node('g', 1000, 200, 400, 'group')] }), { x: 120, y: 120 }); assert.deepEqual(m.nextCanvasPlacement({ nodes: [node('a', 120, 200, 260), node('b', 0, 10, 500)] }), { x: 32, y: 42 }); assert.deepEqual(m.nextCanvasPlacement({ nodes: [node('a', 100, 200, 100), node('b', 0, 10, 200)] }), { x: 132, y: 232 }); });
await check('font trim / skip empty / exact duplicate / CSS alias and escaping', () => { const result = m.createFontOptions([' z ', 'z', '', '  ', 'A', 'a', 'ヒラギノ明朝 Pro W3', 'A"B']); assert.equal(result.filter(x => x.label === 'z').length, 1); assert.equal(result.filter(x => x.label === 'A' || x.label === 'a').length, 2); assert.equal(result.find(x => x.label === 'ヒラギノ明朝 Pro W3').cssFamily, '"Hiragino Mincho Pro", "ヒラギノ明朝 Pro"'); assert.equal(result.find(x => x.label === 'A"B').cssFamily, '"A\\"B"'); assert.deepEqual(result.map(x => x.label), result.map(x => x.label).sort((a, b) => a.localeCompare(b))); });
await check('font browser fallback / no IPC / nine entries', async () => { globalThis.window = {}; let calls = 0; globalThis.__fontInvoke = () => { calls++; throw Error('must not call'); }; assert.deepEqual(await m.loadSystemFonts(), m.fallbackFontOptions); assert.equal(m.fallbackFontOptions.length, 9); assert.equal(calls, 0); });
await check('font native IPC / empty result fallback / rejection propagates', async () => { globalThis.window = { __TAURI_INTERNALS__: {} }; const calls = []; globalThis.__fontInvoke = async (...args) => { calls.push(args); return [' B ', 'A', 'B']; }; assert.deepEqual((await m.loadSystemFonts()).map(x => x.label), ['A', 'B']); assert.deepEqual(calls, [['get_system_fonts']]); globalThis.__fontInvoke = async () => []; assert.deepEqual(await m.loadSystemFonts(), m.fallbackFontOptions); globalThis.__fontInvoke = async () => { throw Error('font fail'); }; await assert.rejects(m.loadSystemFonts(), /font fail/); });
// Render the real Hook. The React adapter above only observes setter calls;
// it lets the test detect a stale update even when React ignores it after unmount.
const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__fontStateWrites = 0;
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const mount = () => { const node = document.createElement('div'); document.body.append(node); const root = createRoot(node); let value; function Probe({ load, nonce }) { value = m.useSystemFonts(load); return React.createElement('span', null, value.map(x => x.label).join('|')); } return { root, node, read: () => value, render: async (load, nonce = 0) => React.act(async () => root.render(React.createElement(Probe, { load, nonce }))), unmount: async () => { await React.act(async () => root.unmount()); node.remove(); } }; };
try {
    await check('Hook initial fallback / async success / no reload on render', async () => {
        const d = deferred();
        let calls = 0;
        const load = () => { calls++; return d.promise; };
        const h = mount();
        try {
            await h.render(load);
            assert.deepEqual(h.read(), m.fallbackFontOptions);
            await h.render(load, 1);
            assert.equal(calls, 1);
            const fonts = [{ label: 'OS Font', cssFamily: '"OS Font"' }];
            await React.act(async () => { d.resolve(fonts); await d.promise; });
            assert.deepEqual(h.read(), fonts);
            assert.equal(calls, 1);
        }
        finally {
            await h.unmount();
        }
    });
    await check('Hook failure keeps fallback', async () => {
        const h = mount();
        try {
            await h.render(() => Promise.reject(Error('unavailable')));
            assert.deepEqual(h.read(), m.fallbackFontOptions);
        }
        finally {
            await h.unmount();
        }
    });
    await check('Hook unmount cancels success and failure updates', async () => {
        for (const failure of [false, true]) {
            const d = deferred();
            const h = mount();
            await h.render(() => d.promise);
            await h.unmount();
            const before = globalThis.__fontStateWrites;
            await React.act(async () => {
                if (failure)
                    d.reject(Error('late failure'));
                else
                    d.resolve([{ label: 'late', cssFamily: 'late' }]);
                await d.promise.catch(() => { });
            });
            assert.equal(globalThis.__fontStateWrites, before, 'unmounted request must not call the state setter');
        }
    });
    await check('Hook remount isolates old request from new instance', async () => {
        const old = deferred(), next = deferred();
        const a = mount();
        await a.render(() => old.promise);
        await a.unmount();
        const b = mount();
        try {
            await b.render(() => next.promise);
            const before = globalThis.__fontStateWrites;
            await React.act(async () => { old.resolve([{ label: 'old', cssFamily: 'old' }]); await old.promise; });
            assert.equal(globalThis.__fontStateWrites, before);
            assert.deepEqual(b.read(), m.fallbackFontOptions);
            const fonts = [{ label: 'new', cssFamily: 'new' }];
            await React.act(async () => { next.resolve(fonts); await next.promise; });
            assert.deepEqual(b.read(), fonts);
        }
        finally {
            await b.unmount();
        }
    });
    await check('Hook StrictMode replay cancels first request', async () => {
        const pending = [deferred(), deferred()];
        let calls = 0, value;
        const load = () => pending[calls++].promise;
        const node = document.createElement('div');
        document.body.append(node);
        const root = createRoot(node);
        function Probe() { value = m.useSystemFonts(load); return React.createElement('span', null, value.map(x => x.label).join('|')); }
        try {
            await React.act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Probe))));
            assert.equal(calls, 2);
            const before = globalThis.__fontStateWrites;
            await React.act(async () => { pending[0].resolve([{ label: 'cancelled', cssFamily: 'cancelled' }]); await pending[0].promise; });
            assert.equal(globalThis.__fontStateWrites, before);
            assert.deepEqual(value, m.fallbackFontOptions);
            const fonts = [{ label: 'replayed', cssFamily: 'replayed' }];
            await React.act(async () => { pending[1].resolve(fonts); await pending[1].promise; });
            assert.deepEqual(value, fonts);
        }
        finally {
            await React.act(async () => root.unmount());
            node.remove();
        }
    });
}
finally {
    dom.window.close();
    delete globalThis.__fontInvoke;
    delete globalThis.__fontStateWrites;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
console.log('PASS app models and system fonts: ' + checked.length + ' cases (including real React lifecycle)');
