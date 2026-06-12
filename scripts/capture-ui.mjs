import { writeFile } from "node:fs/promises";

const debugPort = process.env.EDGE_DEBUG_PORT ?? "9223";
const endpoint = `http://127.0.0.1:${debugPort}/json`;
const pages = await fetch(endpoint).then((response) => response.json());
const page = pages.find((item) => item.url === "http://127.0.0.1:5173/");

if (!page) {
  throw new Error("Local brew page was not found in Edge remote debugging targets.");
}

console.log(`Connecting to ${page.webSocketDebuggerUrl}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.onmessage = (event) => {
  const message = JSON.parse(event.data.toString());
  if (!message.id) return;

  const request = pending.get(message.id);
  if (!request) return;

  pending.delete(message.id);
  if (message.error) {
    request.reject(new Error(message.error.message));
    return;
  }

  request.resolve(message.result);
};

await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

function send(method, params = {}) {
  const id = nextId++;
  console.log(method);
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 10000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
  });
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(path) {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

await send("Page.enable");
await send("Page.bringToFront");
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await wait(1000);
await send("Runtime.evaluate", {
  expression: "document.querySelector('[aria-label=\"スニペットを追加\"]').click()",
});
await wait(400);
await capture("C:/Users/uest/Documents/brew/ui-check-snippet-modal.png");

await send("Runtime.evaluate", {
  expression: "document.querySelector('.modalClose').click()",
});
await wait(200);
await send("Runtime.evaluate", {
  expression: "document.querySelector('[aria-label=\"設定\"]').click()",
});
await wait(400);
await capture("C:/Users/uest/Documents/brew/ui-check-settings-modal.png");

socket.close();
