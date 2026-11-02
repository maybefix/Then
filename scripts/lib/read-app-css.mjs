// CSS本文を確かめるテスト用。標準のローカル @import を、入口に書かれた順に展開する。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function readAppCss(file = new URL("../../src/App.css", import.meta.url), ancestors = []) {
  const absolute = path.resolve(file instanceof URL ? fileURLToPath(file) : file);
  if (ancestors.includes(absolute)) throw new Error(`CSS import cycle: ${[...ancestors, absolute].join(" -> ")}`);
  const source = await readFile(absolute, "utf8");
  const imports = [...source.matchAll(/^@import\s+["']([^"']+)["'];[\t ]*\r?$/gm)];
  let result = "";
  let offset = 0;
  for (const match of imports) {
    result += source.slice(offset, match.index);
    result += await readAppCss(path.resolve(path.dirname(absolute), match[1]), [...ancestors, absolute]);
    offset = match.index + match[0].length;
  }
  return result + source.slice(offset);
}
