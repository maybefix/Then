# アプリ内ダイアログ 分離の手順書

App.tsx が持っている「アプリ内ダイアログ」（名前の入力、確認、二択、選択肢、新規ファイルの作成）の値と操作を、`src/components/dialogs/useAppDialog.ts` のフック `useAppDialog` へ移す。ダイアログの見た目・文言・ボタンの並び・答えの返り方は変えない。

- ブランチ: `refactor/app-dialog`（`refactor/app-state-normalize` の上に積む。そちらはまだ main に入っていないため）
- 戻し先: タグ `checkpoint/before-app-dialog`（コミット `eadfaf3`。中身は `refactor/app-state-normalize` の `96f630c` と同じ）
- 行番号は `eadfaf3` の時点のもの。

| 工程 | 内容 | 状態 |
|---|---|---|
| 1 | 調査 | 済み |
| 2 | 仕組みの説明 | 済み |
| 3 | 依存関係 | 済み |
| 4 | 影響範囲 | 済み（4-4 は「前」の一式の結果待ち） |
| 5 | 案 | 済み |
| 6 | 人の確認（確認1） | |
| 7 | 実施 | |
| 8 | 自動テスト | |
| 9 | 実機確認 | |
| 10 | 完了（確認2） | |

## 工程1: 調査の結果

- 値: `const [appDialog, setAppDialog] = useState<AppDialog | null>(null);`（1300行）。型 `AppDialog` は `src/types.ts`（758〜820行）。
- 操作の関数: 4730〜4983行（254行）にまとまっている。途中にほかの処理は挟まっていない。
  - 開く: `requestInput`、`requestMultiInput`、`requestCreateFile`、`requestConfirm`、`requestChoice`、`requestOption`
  - 画面から呼ばれる: `closeAppDialog`、`submitAppDialog`、`updateAppDialogValue`、`updateAppDialogFieldValue`、`chooseAppDialogOption`、`chooseAppDialog`
- 表示: `<AppDialogModal>` が2か所（起動画面の上 8743行、作品の画面のいちばん上 9627行）。渡す props は同じ7つ。
- `setAppDialog` を直接呼んでダイアログを開いている所が、関数の外に4か所ある。
  - 1775行 資料の新規作成の名前（`handleCreateReference`、useCallback の中）
  - 1817行 資料ファイルの削除の確認（`handleDeleteImportedReference`、useCallback の中）
  - 1917行 Idea から資料を外すときの確認（`removeIdeaReference`、useCallback の中）
  - 8071行 新しいスレッドの名前（`requestNewIdeaThreadName`）
  どれも `requestInput`／`requestConfirm` と同じ形の値を自分で組み立てている（`requestInput` との違いは `optional` を書いていないことだけで、書かないと「必須」になり、`optional: false` と同じ）。
- `appDialog` を読んでいる所: 起動時の「保存されていない編集」の確認（8503〜8538行の useEffect。ダイアログが出ている間は待つ）と、上の2か所の表示。
- 使われていない関数はない。
- App.tsx の文字列を読むテストで、移す範囲を目印にしているものはない。`test:binder` が `title: "新規スレッドに追加"` を App.tsx に探している（8071行の呼び出し元に残る文言なので、移しても App に残る）。
- フックの置き場所: `src/components/dialogs/` に `AppDialogModal.tsx` と `useModalFocus.ts` がある。そこに並べる。

## 工程2: 仕組みの説明

### 言葉
- **アプリ内ダイアログ**: OS のダイアログではなく、Then の画面の中に出す小さな窓。開いている間、後ろの操作はできない。
- **Promise（約束）**: 「あとで答えを渡す」入れ物。`await requestConfirm(...)` と書くと、利用者がボタンを押すまでその処理が止まって待つ。
- **resolve**: Promise に答えを渡す関数。ダイアログの値の中にしまっておき、ボタンが押されたときに呼ぶ。
- **フック**: `use` で始まる関数。中で `useState` などを使える。部品（App）の中で毎回同じ順番で呼ぶ決まりがある。

### 1. データの形
`appDialog` は、今出ているダイアログ1つか、出ていなければ `null`。種類（`type`）ごとに持つ値が違う。

| 種類 | 画面 | 答え |
|---|---|---|
| `input` | 1行の入力欄 | 入力した文字（前後の空白を除く）／閉じたら `null` |
| `multiInput` | 複数の入力欄（選択や複数行を含む） | 欄ごとの文字の組／`null` |
| `createFile` | 名前・拡張子・ひな形 | `{ fileName, templateId }`／`null` |
| `confirm` | はい／いいえ | `true`／`false` |
| `choice` | 2つのボタン | `"primary"`／`"secondary"`／`null` |
| `options` | 説明つきの選択肢の一覧 | 選んだ `id`／`null` |

### 2. 利用者の操作と内部の処理

| 操作 | 関数 | 内部で起きること |
|---|---|---|
| 処理がダイアログを出す | `request*` | ダイアログの値に resolve をしまって `appDialog` に置き、Promise を返す。前のダイアログが出ていても、確かめずに置き換える |
| 文字を打つ | `updateAppDialogValue` | `input` の値を書き換え、エラーの文を消す |
| 複数欄・新規ファイルの欄を変える | `updateAppDialogFieldValue` | `createFile` は名前・拡張子（txt か md のときだけ）・ひな形、`multiInput` は該当する欄を書き換え、エラーを消す |
| 決定（Enter／決定ボタン） | `submitAppDialog` | `confirm` は `true`、`choice` は `"primary"`、`options` は何もしない。入力系は前後の空白を除き、必須が空ならエラーの文を出して開いたまま。`createFile` は打った名前の末尾の `.txt`／`.md` を外し、選んだ拡張子を付ける |
| 二択のボタン | `chooseAppDialog` | `choice` のときだけ、押したほうを答える |
| 選択肢を押す | `chooseAppDialogOption` | `options` のときだけ、その `id` を答える |
| 閉じる（Esc／×／取り消し） | `closeAppDialog` | `confirm` は `false`、ほかは `null` を答える |

答えを渡すと `appDialog` は `null` に戻り、ダイアログが消える。

### 3. 保存
保存しない。アプリを閉じれば消える。作品を切り替えても、出ているダイアログはそのまま。

### 4. ほかの機能との関係
- 呼ぶ側は約30か所。App の中の操作（タブを閉じる確認、作品の切り替え、チェックポイント、設定の変更など）と、App の外の操作のファイル（`projectEntryActions`、`headingMoveActions`、`ideaThreadActions` など）に deps で渡している。
- 起動時の「保存されていない編集」の確認は、`appDialog` が出ている間は待つ。

### 5. 今の挙動の癖
- **(癖1) ダイアログが重なると、先に出ていたほうの答えが来ない。** `request*` は前のダイアログを確かめずに置き換えるので、先に待っていた処理は答えをもらえず、止まったままになる。見込みで起こりうる場面: 起動時に「古い共通データを削除できませんでした」（8415行。ダイアログが出ているかを確かめない）と「保存されていない編集が残っています」（8519行）が同じ起動で出るとき。後者が先に出てから前者に置き換わると、後者の処理が止まり、その起動の間は残りの「保存されていない編集」も尋ねなくなる（記録は残るので次の起動でまた尋ねる）。コードを読んでの見込みで、実機ではまだ確かめていない。
- 入力欄が空のときの文は、欄の名前に関わらず「名前を入力してください」（`multiInput` は「<欄の名前>を入力してください」）。欄はどれも名前（作品名・ファイル名・フォルダ名・スレッド名）なので、ずれはない。直さない。

## 工程3: 依存関係

- **A. React に依存しない処理**: なし（どの関数も `setAppDialog` を使う）。
- **B. 値**: `appDialog`。App の useState。保存しない。ほかの値と1回の更新でまとめて書くことはない。
- **C. 操作の関数**: 2章の表の12個。使うのは `setAppDialog` だけで、App のほかの値を読まない。
- **C-外**: `setAppDialog` を直接使う4か所（工程1）。3か所は useCallback の中で、依存の配列に `setAppDialog` を入れていない（useState の書き換え関数は変わらないので、それで正しい）。
- **D. 自動で走る処理**: 「保存されていない編集」の確認が `appDialog` を依存にしている（App に残る）。
- **E. 作品を開く経路**: 関係しない。
- **F. 画面部品**: `AppDialogModal` に `dialog` と6つの関数。2か所。
- **G. App の外**: なし。
- **H. 文字列を読むテスト**: `test:binder` の `title: "新規スレッドに追加"`（App に残る）。`FormEvent` の import は `submitAppDialog` だけが使っている。

結び目:
1. 値（useState）ごと移すと、App の中の useState の並びの1つがフックの呼び出しになる。同じ位置で呼べば、React が値を覚える順番は変わらない。
2. App の外の4か所が `setAppDialog` を直接使っている。
3. 操作の関数を、宣言より前の行（4045行の `handleClearFrontMatter` など）が後から呼ばれる関数の中で使っている。フックを1300行で呼ぶと、宣言が前へ来るだけなので、壊れる所はない。

## 工程4: 影響範囲

### 4-1. 変わるファイル
- 必ず変わる: `src/App.tsx`、新しい `src/components/dialogs/useAppDialog.ts`、新しい回帰テスト `scripts/test-app-dialog.mjs` と `package.json` の登録。
- 変えない: `src/types.ts`、`AppDialogModal.tsx`、App の外の操作のファイル、Rust。

### 4-2. まとまりごとの影響
| まとまり | 重さ | 理由 |
|---|---|---|
| 値をフックへ移す | 中 | 置く位置を間違えると、React が覚える値の順番がずれる。1300行の同じ位置に置けば変わらない |
| 操作の関数を移す | 中 | 確認・入力のすべてが通る。答えの値（`false` と `null` の違いなど）が変わると、削除や破棄の確認が誤って進む |
| 4か所の直接呼び出し | 低 | 置き換えるなら、組み立てる値が同じであること |
| 表示（JSX） | 低 | 名前を変えないので触らない |

データ消失（高）に当たるものはない。保存も作品を開く経路も関係しない。ただ、確認ダイアログの答えが誤ると、削除・破棄・上書きがそのまま進むので、答えの値を回帰テストで全部確かめる。

### 4-3. 起こりうる回帰と、今のテストで気づけるか
| 回帰 | 今のテスト |
|---|---|
| 閉じたときの答えが `false`／`null` で入れ替わる | なし |
| 必須の欄が空でも決定できる／エラーが出ない | なし |
| 新規ファイルの拡張子の付け方が変わる | なし |
| 起動画面の上でダイアログが出ない | なし（実機で確かめる） |

### 4-4. 今の自動テストの状態
（「前」の一式の結果を、終わったら書く）

## 工程5: 案

### 5-1. 方針
- `useAppDialog()` が `useState` を1つだけ持ち、2章の12個の関数と `appDialog`（と、決めてほしいこと2による `setAppDialog`）を返す。中身・文言・条件・順番は今のまま写す。
- App は1300行の useState の行を `const { ... } = useAppDialog();` に置き換え、今と同じ名前で取り出す。JSX と呼ぶ側は変えない。
- フックの中で `useCallback`・`useEffect` は使わない（今も関数は描画のたびに作り直している。同じにする）。

### 決めてほしいこと

**1. 形**
- (勧め) **フック `useAppDialog` に値ごと移す。** これまでの分離では「新しいファイルに useState を持ち込まない」としてきた。理由は、フックにすると React が値を覚える順番や effect の順番が変わるから。今回は useState が1つだけで effect がなく、今 useState がある1300行と同じ位置で呼ぶので、順番は変わらない。値と、それを書き換える関数が同じ場所にそろう。
- 値は App に残し、関数だけを `createAppDialogActions(setAppDialog)` へ移す（これまでと同じ形）。名前は勧告の `useAppDialog` と違う。

**2. `setAppDialog` を直接使う4か所**
- (勧め) **`requestInput`／`requestConfirm` の呼び出しに置き換え、`setAppDialog` をフックの外に出さない。** 組み立てる値は同じ（違いは `optional` を書かないことだけで、意味は同じ）。置き換えないと、ダイアログを開く道が App にも残り、3 の順番待ちを入れても、この4か所だけはすり抜ける。移すコミットとは別のコミットにする。
- 置き換えず、フックが `setAppDialog` も返す（引っ越しだけ）。

**3. 癖1（ダイアログが重なると、先のほうの答えが来ない）**
- (勧め) **このブランチで、分離の後に直す。** 後から来たダイアログを、今のダイアログが閉じるまで待たせる（順番待ち）。先に「今は落ちるテスト」を書いてから直す。フックの中だけで完結するので、回帰テストで直接確かめられる。実機で同じ起動に2つを出すのは難しいので（削除の失敗を起こす必要がある）、実機では「ダイアログが1つずつ出ること」を、開発者ツールから2つ続けて開いて確かめる。
- 別のブランチで直す。
- 記録だけにする（`docs/KNOWN_ISSUES.md`）。

### テストの直し方と足すテスト
- 直すテスト: なし（移す範囲を読むテストがない）。`npx tsc --noEmit` と build で、取り出す名前の漏れを拾う。
- 足す: `test:app-dialog`（`scripts/test-app-dialog.mjs`）。esbuild でフックを束ね、`react` を「useState の値を1つ覚えるだけ」の代わりに差し替えて、描画のたびにフックを呼び直す形で動かす。確かめること:
  - 6種類それぞれを開いて、決定・閉じる・二択・選択肢で返る答え（`confirm` を閉じたら `false`、ほかは `null` など）
  - 必須の欄が空のときのエラーの文と、ダイアログが開いたままのこと。打ち直すとエラーが消えること
  - 前後の空白を除くこと、`createFile` の拡張子の付け替え、拡張子に txt／md 以外を入れても変わらないこと
  - 種類が違うときに、ほかの種類の関数が何もしないこと（例: `confirm` に `chooseAppDialog`）
  - （3 を直すなら）重なったときに、先のダイアログが残り、閉じると次が出て、両方に答えが届くこと
- 効くことの確かめ: フックにわざと不具合を2つ入れて（`confirm` を閉じたときの答えを `null` に、必須のチェックを外す）、落ちることを見て戻す。

### 進め方とコミット
1. `refactor:` 値と12個の関数を `useAppDialog.ts` へ移す（move-lines と verify-move で、元と同じことを確かめる）。テストを足すのは次のコミット。
2. `test:` `test:app-dialog` を足す。
3. （2 を勧めどおりにするなら）`refactor:` 4か所を `request*` に置き換え、`setAppDialog` を返さないようにする。
4. （3 を直すなら）`test:` 重なったときのテスト（今は落ちる）→ `fix:` 順番待ちにする。
5. `docs:` 結果を書く。

### 見込みと、今回やらないこと
- App.tsx は約250行減る見込み。
- やらない: ダイアログの見た目や文言の変更、`confirmDiscardDirtyWorkspace` などダイアログを使う側の処理の移動、`AppDialog` 型の置き場所の変更。

## 工程6: 人の確認

## 工程7: 実施

## 工程8: 自動テスト

## 工程9: 実機確認

## 工程10: 完了
