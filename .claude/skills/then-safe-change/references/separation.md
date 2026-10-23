# 機能の分離（挙動を変えずに場所だけ移す）

2026-10-23 の Idea の分離（`docs/IDEA_SEPARATION_PLAN.md`）で通した手順。App.tsx から別の機能（Reference、Canvas の連携、Plot など）を切り離すときも、同じ形で進める。

## 目次
1. 調査の進め方
2. 依存関係の書き方（A〜H）
3. 影響範囲の重さの付け方
4. 分離案の線引き
5. 実施のやり方（move-lines の spec）
6. React で壊れやすいところ
7. テストの直し方と回帰テスト
8. 実機で確かめる項目

## 1. 調査の進め方

1. 機能の名前の揺れを先に集める。Idea のときは、保存名が `snippets`、表示名が「バインダー」、コード上の名前が `Idea` だった。`grep -nic` でそれぞれ数え、App.tsx の中の該当する行の一覧を作る。
2. 一覧を「部品の外の関数（純粋な処理）」「state」「操作の関数」「useEffect」「作品を開く経路」「JSX」に振り分けて、範囲ごとに読む。
3. `symbol-uses.mjs` で、関数ごとの呼び出し元を確かめる。1回しか出ない関数は使われていない（Idea では7つあった）。使われていない関数だけが使っている部品の外の関数も、芋づる式に洗い出す。
4. `text-deps.mjs App.tsx` で、App.tsx の文字列を確かめているテストを一覧にする。`section(app, "const A", "const B")` のように、関数名を範囲の目印に使っているテストもある。目印に使われている関数は動かさない。
5. 保存の流れを、Rust 側の命令名、保存先のファイル、遅延保存の時間、保存を止める条件（Idea では `snippetWorkspacePath`）まで確かめる。

## 2. 依存関係の書き方（A〜H）

手順書の工程3は、次の分け方で表にする。各行に「読む／書く／呼ばれる／呼ぶ」を書く。

- **A. React に依存しない処理**: 部品の外の関数と定数。別ファイルへ移しやすい。
- **B. 値（state）**: どこで持ち、何に保存されるか。ほかの機能と共有しているか（`appState` の一部か、など）。
- **C. 操作の関数**: 利用者の操作ごとに、C-1、C-2、… と分ける。資料など、ほかの機能の処理を呼ぶものは、そのことを書く。使われていない処理は C-9 のように別にまとめる。
- **D. 自動で走る処理（useEffect）**: きっかけと、保存との関係。
- **E. 作品を開く経路**: 起動時の復元、作品の切り替え、ファイルを開いたときの作品の変化、後からの検知。複数の値を1回の `setAppState` でまとめて書いているか。
- **F. 画面部品への受け渡し（JSX）**: 部品ごとに、渡す props。
- **G. App の外とのやり取り**: Rust の命令、ウィンドウ間の知らせ、ドラッグのデータの種類。
- **H. App.tsx の文字列を読むテスト**: テストごとに、確かめている文字列。

最後に「結び目」（切り離すときに引っかかる所）を箇条書きにする。Idea では、値が `appState` の中にあること、並び順が別の値（資料レイアウト）にあること、1回の操作で2か所を書くこと、App の道具（通知・確認・ダイアログ）に頼っていること、共有の処理、テストの文字列への依存、の7つだった。

## 3. 影響範囲の重さの付け方

- **高（データ消失）**: 値の置き場所、保存の条件、作品を開く経路、読み込み時の正規化、ほかの作品のファイルへ書く処理。ここを動かすと、前の作品のデータを新しい作品に上書きするような事故が起こりうる。
- **中（表示順・連携）**: 2か所を続けて書く組、`useCallback` の依存の指定、ウィンドウ間の知らせの登録、useEffect の順番。
- **低**: 使われていない処理、表示の位置、通知の文言（ただしテストが確かめている文言は中）。

機能ごとの表では、既存のテストで気づけるかを「なし／文字列だけ／実際に動かしている」で書く。「文字列だけ」は、移した先で動くことを保証しない。

## 4. 分離案の線引き

Idea で確認1を通った線引き。次の分離でも、まずこの形を出す。

1. **値は全部 App に残す。** 保存、作品を開く経路、自動で走る処理も App に残す。高の危険を避けるため。
2. **移すのは引っ越しだけ。** 中身・文言・条件・順番はそのまま。違うのは、App の値を直接見ていた所を引数で受け取ることだけ。似た書き方が何か所もあっても、まとめない。
3. **新しいファイルに React の仕組み（useState・useEffect・useCallback）を持ち込まない。** フックにすると、App の中の effect の順番や、React が値を覚える順番が変わる。
   - 純粋な処理 → `src/<feature>Model.ts`（既存の `src/ideaReferenceModel.ts` と並べる）
   - 操作 → `src/<feature>Actions.ts` に `create<Feature>Actions(deps)` を置き、操作の関数をまとめて返す。App は、元の処理があった場所でこれを呼び、今と同じ名前で取り出す。JSX は変えない。
   - App の値は、描画のたびにその時点の値を deps で渡す（元の書き方と同じ意味になる）。`referenceLayout.ideaThreads` のように中身を参照しているなら、`referenceLayout` ごと渡すと、移すコードを1文字も変えずに済む。
   - ウィンドウ間の知らせ（`listen`）の登録は App の useEffect に残し、受け取った後の処理だけを移す。
4. **残すもの**: ほかの機能と共有している処理（資料の追加・削除、AI に渡す処理、移動・コピーの道具、Canvas を開く処理）、テストの目印になっている関数、使われていない処理（消すかどうかは確認1で決める）、`useCallback` で包まれた処理（依存の指定ごと写すのは、その機能を分けるときにまとめて行う）。
5. **UI 側へ移すもの**: props の形が変わるなら、今回は移さない。候補として手順書に書く。
6. **使われていない処理**: 消すなら、別のコミットにする。テストが確かめている文言がその中にあるときは、消すことが仕様の判断になるので（Idea では「並べ替えの元に戻す」）、確認1で決めてもらう。勧めは「今回は触らない」。

## 5. 実施のやり方（move-lines の spec）

1. 移す範囲の、今の行番号と、先頭と末尾の行の中身を確かめる（`sed -n '<from>p;<to>p'`）。
2. spec を scratchpad に書き、`move-lines.mjs <spec> --dry-run` で数を確かめてから実行する。
3. `verify-move.mjs src/App.tsx <新しいファイル>...` で突き合わせる。lost が 0 で、added が import と呼び出しの行だけであること。
4. `npx tsc --noEmit`。足りない型の import を足す。App で使わなくなった import は、`symbol-uses.mjs src/App.tsx <名前...>` で「only once」のものを消す。
5. `file src/App.tsx` で CRLF のままかを確かめる。
6. テストの読むファイルを直し（7章）、build と関係するテストを動かしてコミットする。

spec の例（操作を移したとき。行番号はその時点のもの）:

```json
{
  "source": "src/App.tsx",
  "target": "src/ideaThreadActions.ts",
  "blocks": [
    { "name": "drag", "from": 11259, "to": 11261, "first": "  const isSnippetDragEvent = (event: DragEvent<HTMLElement>) => {", "last": "  };", "removeTrailingBlank": true },
    { "name": "copy", "from": 11980, "to": 12044, "first": "      const items = request.items", "last": "      showToast(`${items.length} 件を Idea へ取り込みました`);", "dedent": 2,
      "leave": ["      receiveCanvasCopyToIdea(event.payload);"] }
  ],
  "targetLayout": [
    "import type { Dispatch, DragEvent, SetStateAction } from \"react\";",
    "",
    "export function createIdeaThreadActions(deps: IdeaThreadActionDeps) {",
    "  const { snippets, setAppState } = deps;",
    "",
    { "block": "drag" },
    "",
    "  const receiveCanvasCopyToIdea = (request: CanvasCopyToIdeaRequest) => {",
    { "block": "copy" },
    "  };",
    "",
    "  return { receiveCanvasCopyToIdea };",
    "}",
    ""
  ],
  "sourceImport": { "after": "} from \"./ideaThreadModel\";", "lines": ["import { createIdeaThreadActions } from \"./ideaThreadActions\";"] }
}
```

呼び出し（`const { ... } = create<Feature>Actions({ ... });`）は、いちばん後ろの塊の `leave` に書くと、元の位置に置ける。

## 6. React で壊れやすいところ

- **作られる前に読む（TDZ）**: `create<Feature>Actions({ ... })` に渡す値（`showToast`、`requestConfirm` など）は、呼び出し位置より前で宣言されていなければならない。宣言が後ろにあるときは、呼び出し位置を後ろへずらす。返ってきた関数を呼び出し位置より前で使っている所は、`symbol-uses.mjs --call-site <行>` の `before` で確かめる。クリックなどで後から呼ばれる関数の中なら問題ない。`useCallback` や `useMemo` の依存の配列、描画の途中での直接の呼び出しなら壊れる。
- **effect の順番**: useEffect は書いた順に動く。移さなければ順番は変わらない。
- **最初に1回だけ登録する受け取り**（依存の配列が `[]`）: 最初の描画のときの関数を使い続ける。移した関数が使うのが `setState` の関数型の更新と、変わらない値だけなら、意味は変わらない。
- **バンドルの大きさ**: 関数をまとめて返すと、関数名が圧縮で縮まなくなり、少し増える（Idea では 1.5 kB）。`test:v058-bundle` は、元から上限を超えていて失敗する。

## 7. テストの直し方と回帰テスト

- 文字列を読むテストは、確かめる正規表現を変えず、読むファイルだけを移した先に変える（`readFile("src/<feature>Actions.ts")` を足す）。App の JSX に名前が残るもの（`onX={fooBar}` など）は、そのままで通る。
- 回帰テストは esbuild で新しいファイルを束ねて読み込み、App の値の代わりに入れ物を用意する。操作のたびに最新の値で `create<Feature>Actions` を作り直すと、App の描画と同じ形になる（見本: `scripts/test-idea-thread-actions.mjs`）。
- 2か所に分かれた値は、「整合処理が直す所がない」ことを確かめると、食い違いを広く拾える（Idea では `reconcileIdeaThreadLayouts` の結果と並び順を、スレッドごとに比べた。一覧そのものの順番は比べない）。
- 作品を開く経路のような、App に残したものは自動テストでは確かめにくい。実機確認の項目に入れる。

## 8. 実機で確かめる項目

分離した機能の操作を一通り行い、保存ファイルと画面を突き合わせる。そのうえで次を必ず入れる。

- 作品の切り替え（切り替えた先で足したものが、切り替える前の作品のファイルに入らないこと。前の作品のファイルが、切り替えの前後で同じであること）
- 再起動後の復元（画面の全体を、再起動の前後で突き合わせる）
- その機能を使うほかの機能（Idea なら AI・Canvas・カード・Quick Idea）
- 工程2で書いた「今の挙動の癖」が、分離の前と同じであること
