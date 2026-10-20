// Browser-side helpers for manuscript (原稿用紙) mode QA. Evaluated in the page
// by scripts/test-v070-manuscript-browser.mjs; also pasteable into a devtools
// console during manual checks. Defines window.__ms.
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frames = (count = 2) => new Promise((resolve) => {
    const step = () => (--count <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const pm = () => document.querySelector(".ProseMirror");

  const sampleText = () => {
    const lines = [
      "あいうえおかきくけこさしすせそたちつてと",
      "あいうえおかきくけこさしすせそたちつてとな",
      "これはABCです。Hello worldと書く。iPhone 15を買った。",
      "「会話文です。とても長い会話文が続きますのでここで折り返します」",
      "",
      "　字下げの段落。句読点が行末に来る場合の確認です。あいうえおかきくけこさし、すせそ。",
    ];
    for (let i = 0; i < 40; i += 1) {
      lines.push(`　第${i + 1}段落。吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。`);
    }
    lines.push(
      "｜東雲《しののめ》の空が白む。漢字《かんじ》のルビも試す。あいうえおかきく",
      "平成12年12月31日、2人は!?と叫んだ。あいうえおかきくけこさし",
      "あいうえおかきくけこさしすせそたちつて。",
      "あいうえおかきくけこさしすせそたちつ「て」",
      "あいうえおかきくけこさしすせそたちつて「と」",
      "# 見出しの行です",
    );
    return lines.join("\n");
  };

  const paste = (text) => {
    const root = pm();
    root.focus();
    const data = new DataTransfer();
    data.setData("text/plain", text);
    root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  };

  // Offset of every character from the paragraph's inline start, and the
  // block position of its line (vertical: distance from the paragraph's right).
  const characters = (paragraph) => {
    const out = [];
    const vertical = getComputedStyle(paragraph).writingMode !== "horizontal-tb";
    const box = paragraph.getBoundingClientRect();
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(".mk-hidden")) continue;
      for (let i = 0; i < node.data.length; i += 1) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        out.push({
          ch: node.data[i],
          offset: vertical ? rect.top - box.top : rect.left - box.left,
          line: Math.round(vertical ? box.right - rect.right : rect.top - box.top),
        });
      }
    }
    return out;
  };

  // Japanese characters must start on a cell boundary (multiple of 1ic).
  const check = (index) => {
    const root = pm();
    const ic = Number.parseFloat(getComputedStyle(root).fontSize);
    const paragraph = root.children[index];
    const chars = characters(paragraph);
    const lines = [...new Set(chars.map((c) => c.line))];
    return {
      lines: lines.length,
      first: chars.filter((c) => c.line === lines[0]).map((c) => c.ch).join(""),
      misaligned: chars
        .filter((c) => /[぀-ヿ一-鿿]/.test(c.ch) && Math.abs(c.offset / ic - Math.round(c.offset / ic)) > 0.05)
        .map((c) => `${c.ch}@${c.offset.toFixed(2)}`),
    };
  };

  // Lines actually laid out, from paragraph block sizes (an independent count).
  const laidOutLines = () => {
    const root = pm();
    const pitch = Number.parseFloat(getComputedStyle(root).lineHeight);
    const vertical = getComputedStyle(root).writingMode !== "horizontal-tb";
    let sum = 0;
    for (const p of root.children) {
      if (p.classList.contains("pm-comment") || getComputedStyle(p).display === "none") continue;
      sum += Math.round((vertical ? p.getBoundingClientRect().width : p.getBoundingClientRect().height) / pitch);
    }
    return sum;
  };

  const status = () => {
    const el = document.querySelector(".statusManuscript");
    return el ? { text: el.textContent.trim(), title: el.getAttribute("title") } : null;
  };

  const openSettings = async () => {
    document.querySelector('button[aria-label="設定"]').click();
    await sleep(200);
    document.getElementById("settings-tab-body")?.click();
    await sleep(200);
  };
  const closeSettings = async () => {
    document.querySelector('.settingsModal button[aria-label="閉じる"]')?.click();
    await sleep(300);
    await frames(3);
  };
  const label = (text) => [...document.querySelectorAll(".settingsModal label")]
    .find((l) => (l.querySelector("span")?.textContent.trim() ?? "") === text);
  const setSelect = async (text, value) => {
    await openSettings();
    const select = label(text)?.querySelector("select");
    if (!select) throw new Error(`setting not found: ${text}`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await closeSettings();
  };
  const setNumber = async (text, value) => {
    await openSettings();
    const input = label(text)?.querySelector("input");
    if (!input) throw new Error(`setting not found: ${text}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await closeSettings();
  };
  const setCheck = async (text, checked) => {
    await openSettings();
    const input = label(text)?.querySelector('input[type="checkbox"]');
    if (!input) throw new Error(`setting not found: ${text}`);
    if (input.checked !== checked) input.click();
    await closeSettings();
  };

  window.__ms = { sleep, frames, pm, sampleText, paste, characters, check, laidOutLines, status, setSelect, setNumber, setCheck };
})();
