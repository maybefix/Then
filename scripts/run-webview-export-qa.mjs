const endpoint = process.argv[2] ?? "http://127.0.0.1:9223/json";
const outputPath = process.argv[3];
if (!outputPath) throw new Error("PDF output path is required");

const targets = await fetch(endpoint).then((response) => response.json());
const page = targets.find((target) => target.type === "page" && target.url.includes("localhost:1420"));
if (!page?.webSocketDebuggerUrl) throw new Error("Then WebView2 target was not found");

const sourceParagraph = "これは[日本語(rb,に ほん ご)]のルビと、[傍点(em,goma)]、西暦[2026(tcy)]年の縦中横を確認する文章です。";
const source = [
  "# 縦書きPDF組版テスト",
  ...Array.from({ length: 36 }, (_, index) =>
    index % 9 === 0 ? `## 第${index / 9 + 1}節\n${sourceParagraph}` : sourceParagraph,
  ),
].join("\n\n");
const cacheBuster = Date.now();

const expression = `
(async () => {
  const [{ createLinkedExportDocument }, { DEFAULT_EXPORT_LAYOUT }, { renderPrintDocument }] = await Promise.all([
    import('/src/export/linkedDocument.ts?qa=${cacheBuster}'),
    import('/src/export/types.ts?qa=${cacheBuster}'),
    import('/src/export/nativePrint.ts?qa=${cacheBuster}'),
  ]);
  const source = ${JSON.stringify(source)};
  const loadedSources = [{ id: 'qa-1', path: '', extension: 'txt', displayName: 'PDF組版テスト.txt', chars: source.length, enabled: true, order: 0, startMode: 'continue', markupMode: 'then-markup', content: source }];
  const job = { format: 'pdf', title: 'PDF組版テスト', sources: loadedSources.map(({ content, ...item }) => item), layout: DEFAULT_EXPORT_LAYOUT };
  const exportDocument = createLinkedExportDocument(job, loadedSources);
  const viewport = document.createElement('div');
  viewport.className = 'printExportViewport';
  document.querySelector('.appShell').appendChild(viewport);
  document.body.classList.add('thenPdfExporting');
  document.documentElement.setAttribute('data-export-paginated', 'true');
  try {
    const pageCount = await renderPrintDocument(exportDocument, viewport);
    const result = await window.__TAURI_INTERNALS__.invoke('export_pdf', {
      path: ${JSON.stringify(outputPath)},
      pageWidthMm: 128,
      pageHeightMm: 182,
      marginTopMm: 0,
      marginRightMm: 0,
      marginBottomMm: 0,
      marginLeftMm: 0,
    });
    return { pageCount, result, sourceCount: exportDocument.sections.length };
  } finally {
    document.body.classList.remove('thenPdfExporting');
    document.documentElement.removeAttribute('data-export-paginated');
    viewport.remove();
  }
})()`;

const socket = new WebSocket(page.webSocketDebuggerUrl);
const response = await new Promise((resolve, reject) => {
  const id = 1;
  const timeout = setTimeout(() => reject(new Error("WebView2 QA timed out")), 90_000);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== id) return;
    clearTimeout(timeout);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else if (message.result?.exceptionDetails) {
      reject(new Error(message.result.exceptionDetails.exception?.description ?? "WebView2 QA failed"));
    } else resolve(message.result?.result?.value);
  });
  socket.addEventListener("error", () => reject(new Error("WebView2 QA socket failed")));
});

socket.close();
console.log(JSON.stringify(response));
