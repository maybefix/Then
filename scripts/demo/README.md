# Then デスクトップ録画

Tauri版の `Then.exe` を起動し、プライマリ画面全体をFFmpegで録画します。WebView内はCDPで要素を特定して操作し、Windowsのフォルダ選択ダイアログはキーボード操作で進めます。各クリックの時刻と画面上の位置を `timeline.json` に記録し、編集工程で対象へ滑らかにズームします。

録画時には `scripts/demo/sample-workspace` を `artifacts/demo/workspace` へコピーして使用します。メモ追加や `.then/project.json` の生成はコピー側だけで行われます。

## 実行

Thenを終了してから、リポジトリのルートで実行します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/demo/record-desktop.ps1
```

生成物:

- `artifacts/demo/then-demo-raw.mkv`: 編集前のデスクトップ録画
- `artifacts/demo/timeline.json`: クリック位置と演出タイミング
- `artifacts/demo/then-demo.mp4`: ズームとフェードを適用した完成動画
- `artifacts/demo/workspace`: 録画専用に複製されたサンプルプロジェクト

完成MP4の生成後、素材との尺・解像度・30fps・最終ズーム・全フレーム復号を自動検査します。また、録画用ワークスペースの `.then/project.json` を読み、IdeaのメモとPlotのセクションが実際に保存されたことも確認します。いずれかが不正なら `demo:record` は失敗として終了します。

録画中に作られる最近使ったプロジェクトやチェックポイントが通常利用へ残らないよう、既存の `app-state.json` はメモリ上へ退避し、Then終了後に復元します。

FFmpegがPATHにない場合:

```powershell
$env:THEN_FFMPEG = "C:\path\to\ffmpeg.exe"
powershell -ExecutionPolicy Bypass -File scripts/demo/record-desktop.ps1
```

録画だけ行う場合:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/demo/record-desktop.ps1 -SkipEdit
```

既存の録画を再編集する場合:

```powershell
node scripts/demo/edit-video.mjs artifacts/demo/then-demo-raw.mkv artifacts/demo/timeline.json artifacts/demo/then-demo.mp4
```

既存の完成動画を再検証する場合:

```powershell
npm run demo:validate
```

## シナリオの変更

`scenario.json` の `actions` を編集します。主なアクションは次のとおりです。

- `wait`: 指定ミリ秒待機
- `click`: `aria`、`text`、`placeholder`、`css` のいずれかで要素をクリック
- `type`: inputまたはtextareaへ入力
- `nativeFolderDialog`: Windowsのフォルダ選択ダイアログへパスを入力

`click` に `zoom` を付けると、クリック前後にその要素へズームします。`lead`、`hold`、`tail` で寄り・静止・戻りの秒数を調整できます。

録画には通知、タスクバー、別ウィンドウも含まれます。機密情報が映り込まないよう、録画前に他のアプリと通知を閉じてください。複数モニター環境ではThenをプライマリ画面に最大化して撮影します。

フォルダ選択で停止した場合は、ダイアログを手動で閉じてから再実行してください。録画処理は失敗時にもFFmpegへ終了命令を送り、途中映像を `then-demo-raw.mkv` として残します。
