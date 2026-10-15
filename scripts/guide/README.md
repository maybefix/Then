# Then 操作ガイド生成 PoC

Tauri + WebView2 の Then を Chrome DevTools Protocol (CDP) から操作し、操作シナリオから次の成果物を生成する試作です。

- `guide.md`: 番号付きの操作手順
- `steps.json`: 操作手順の機械可読データ
- `screenshots/001.png` など: 操作対象へ番号を表示したスクリーンショット

Computer Use や座標クリックは使用しません。UI要素は `aria-label`、表示テキスト、placeholder、CSS selector から特定します。

## 実行

Then をビルドした状態で、リポジトリのルートから次を実行します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/guide/run-guide.ps1
```

既定では `scripts/guide/scenario.json` を実行し、`artifacts/guide` へ成果物を生成します。

別のシナリオを指定する場合は次のように実行します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/guide/run-guide.ps1 `
  -Scenario scripts/guide/my-guide.json `
  -OutputDirectory artifacts/guide/my-guide
```

## シナリオ

通常の操作アクションへ `guide` を追加すると、そのアクションが操作ガイドの1工程になります。

```json
{
  "type": "click",
  "target": { "aria": "設定" },
  "label": "設定",
  "guide": {
    "instruction": "［設定］をクリックします。",
    "capture": "before"
  }
}
```

`capture` は次の2種類です。

- `before`: 操作前を撮影します。クリック対象を示す手順に使用します。
- `after`: 操作後を撮影します。入力結果や表示結果の確認に使用します。

クリック操作では `before`、入力と確認では `after` が既定値です。

## 番号表示

`guide.marker` を省略すると、対象要素の右上付近へ赤い丸数字を一時的に表示してからPNGを取得します。番号は1から自動採番します。

確認画面など、特定の対象へ番号を表示しない場合は次のように指定します。

```json
{
  "guide": {
    "instruction": "設定画面が表示されたことを確認します。",
    "capture": "after",
    "marker": false
  }
}
```

位置やサイズを変更する場合は `markerStyle` を指定します。

```json
{
  "guide": {
    "instruction": "［保存］をクリックします。",
    "markerStyle": {
      "size": 40,
      "offsetX": 8,
      "offsetY": -12,
      "background": "#b00020",
      "foreground": "#ffffff"
    }
  }
}
```

## 対応アクション

試作では既存デモと同じ考え方で、次のアクションに対応しています。

- `click`
- `clickIfPresent`
- `type`
- `editorAppend`
- `shortcut`
- `assert`
- `focus`
- `wait`
- `nativeFolderDialog`

WindowsのネイティブダイアログはCDPの管理範囲外です。`nativeFolderDialog` 自体は既存PowerShell補助スクリプトで操作できますが、`Page.captureScreenshot` ではネイティブダイアログを撮影できません。

## 安全策

`run-guide.ps1` は既に Then が実行中の場合に処理を中止します。また、終了時に `%APPDATA%\local.then\app-state.json` を実行前の内容へ戻します。

操作ガイド専用のサンプルワークスペースを利用する場合は、シナリオ内で `${GUIDE_WORKSPACE}` を参照し、実行時に `THEN_GUIDE_WORKSPACE` を指定できます。
