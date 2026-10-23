// QA 用の Then の画面に読み込む手助けの関数（node q.mjs evalfile .../qa-page.js）。
// window.qa に入る。アプリを再起動したら読み込み直す。
// 画面の部品は aria-label と className で探す。見つからないときは throw して、どこで止まったかを返す。
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const must = (value, what) => {
    if (!value) throw new Error(`not found: ${what}`);
    return value;
  };
  const text = (element) => element?.textContent?.trim() ?? "";
  const qa = {
    sleep,
    text,
    async waitFor(check, timeoutMs = 10_000, what = "condition") {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const value = check();
        if (value) return value;
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${what}`);
    },
    /** selector の中で、文字が一致する（startsWith: 先頭が一致する）要素。 */
    byText(selector, label, { startsWith = false, root = document } = {}) {
      return must([...root.querySelectorAll(selector)].find((element) => (startsWith ? text(element).startsWith(label) : text(element) === label)), `${selector} "${label}"`);
    },
    label(name, root = document) {
      return must(root.querySelector(`[aria-label="${CSS.escape(name)}"]`), `[aria-label="${name}"]`);
    },
    /** React が拾う形で select の値を変える（value を直接入れるだけでは onChange が動かない）。 */
    setSelect(select, value) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.selectedOptions[0]?.textContent;
    },
    toast() {
      return text(document.querySelector(".toast")) || null;
    },
    /** 通知のボタン（「元に戻す」など）。操作の付いた通知は5秒で消えるので、操作と同じ eval の中で押す。 */
    clickToast(label = "元に戻す") {
      qa.byText(".toast button", label).click();
    },
    dialogText() {
      return document.querySelector(".modal")?.innerText ?? null;
    },
    dialogButton(label) {
      return qa.byText(".modal button", label);
    },
    /** 起動画面から本文の画面まで進む（ライブラリ設定の「あとで」、「前回の執筆を続ける〈作品名〉」）。 */
    async startup(ready = () => document.querySelector(".ProseMirror"), timeoutMs = 40_000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (ready()) return true;
        const next = [...document.querySelectorAll("button")].find((button) => text(button) === "あとで" || text(button).startsWith("前回の執筆を続ける"));
        next?.click();
        await sleep(500);
      }
      throw new Error(`startup did not finish: ${document.body.innerText.slice(0, 200)}`);
    },
    /** 右サイドバーの表示を切り替える（「バインダー」「プロット」「AI」など）。 */
    async rightPane(label) {
      const button = must([...document.querySelectorAll(".rightPaneSwitcherButton")].find((element) => element.getAttribute("aria-label")?.startsWith("補助ペイン")), "right pane switcher");
      button.click();
      await sleep(250);
      qa.byText(".rightPaneSwitcherPopover button, .rightPaneSwitcherPopover [role^=menuitem]", label, { startsWith: true }).click();
      await sleep(500);
    },
    /** 画面モードを切り替える（「本文」など）。 */
    async mode(label) {
      must(document.querySelector(".modeMenuButton"), "mode menu").click();
      await sleep(250);
      qa.byText(".modeMenu button, .modeMenu [role^=menuitem]", label, { startsWith: true }).click();
      await sleep(800);
    },
    /** 作品を切り替える（パンくずの先頭 →「最近」の一覧）。 */
    async switchWork(name) {
      qa.label("プロジェクトを切り替え").click();
      await sleep(400);
      must([...document.querySelectorAll(".workspaceRecordButton")].find((button) => text(button.querySelector(".workspaceRecordName")) === name), `work "${name}"`).click();
      await qa.waitFor(() => text(document.querySelector(".workspaceSwitcherButton")) === name, 15_000, `work ${name}`);
      await sleep(800);
    },
    async openSettings(tab) {
      // 本文の画面では歯車のアイコンだけ（aria-label）、起動画面では文字のボタン。
      must([...document.querySelectorAll("button")].find((button) =>
        [button.getAttribute("aria-label"), button.title, text(button)].includes("設定")), 'button "設定"').click();
      await sleep(500);
      if (tab) {
        qa.byText(".modal [role=tab], .modal nav button, .settingsTabs button", tab).click();
        await sleep(300);
      }
    },
    /** Idea（右サイドバーの「バインダー」）の操作。 */
    idea: {
      list: () => must(document.querySelector('section.ideaView[aria-label="スレッド一覧"]'), "Idea list"),
      detail: () => must(document.querySelector('section.ideaView[aria-label="スレッド詳細"]'), "Idea detail"),
      threads: () => [...qa.idea.list().querySelectorAll(".ideaThreadRow .ideaRowName")].map(text),
      /** 開いているスレッドの項目。資料は「[資料] 名前」。 */
      items: () => [...qa.idea.detail().querySelectorAll(".ideaScroll article")].map((article) =>
        article.classList.contains("ideaReferenceItem")
          ? `[資料] ${text(article.querySelector("strong")) || text(article.querySelector(".ideaReferencePreview"))}`
          : text(article.querySelector(".ideaFragmentBody"))),
      async open(name) {
        qa.idea.detail().querySelector(".ideaBackBtn")?.click();
        await sleep(300);
        must([...qa.idea.list().querySelectorAll(".ideaThreadRow")].find((row) => text(row.querySelector(".ideaRowName")) === name), `thread "${name}"`).click();
        await sleep(400);
        return qa.idea.items();
      },
      /** 全スレッドの項目を { スレッド名: [項目...] } で返す。保存ファイルとの突き合わせに使う。 */
      async snapshot() {
        const result = {};
        for (const name of qa.idea.threads()) result[name] = await qa.idea.open(name);
        return result;
      },
      fragment: (body) => must([...qa.idea.detail().querySelectorAll("article.ideaFragment")].find((article) => text(article.querySelector(".ideaFragmentBody")) === body), `fragment "${body}"`),
      /** 断片の「移動」「その他」メニューの項目を押す。 */
      async menu(body, which, item) {
        qa.label(which === "move" ? "別スレッドへ移動" : "その他の操作", qa.idea.fragment(body)).click();
        await sleep(250);
        qa.byText(".ideaFragmentMenu [role=menuitem]", item, { startsWith: true }).click();
        await sleep(400);
      },
      /** 入力欄にフォーカスする（そのあと q.mjs type / key Enter で入れる）。where: "list" | "detail"。 */
      focusComposer(where) {
        const root = where === "detail" ? qa.idea.detail().querySelector(".ideaCaptureInline") : qa.idea.list().querySelector(".ideaCapture");
        must(root?.querySelector("textarea"), `${where} composer`).focus();
      },
    },
  };
  window.qa = qa;
  return "qa helpers loaded";
})();
