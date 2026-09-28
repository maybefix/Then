# リリースチェックリスト

## 共通資料・共通Canvas廃止の告知（次回リリース必須）

- GitHub Release本文とインストーラーのダウンロード案内に、更新前の注意を目立つ形で掲載する。
- 告知には「このバージョンを初回起動すると、旧版の共通資料・共通Canvas・そのゴミ箱・中間稿を完全に削除し、Then内にはバックアップを残さない」と明記する。
- 必要な共通資料・共通Canvasは、更新前にユーザー自身でThen外へ書き出す／コピーするよう案内する。
- 作品フォルダ内の資料とCanvasは削除対象ではないことを明記する。
- リリース作業時は [次回リリース告知](./RELEASE_NOTES_NEXT.md) の文面をバージョン番号に合わせて掲載する。

## 第三者ライセンス

Thenのインストーラーを公開する前に、次を確認する。

- `THIRD_PARTY_LICENSES/AGPL-3.0.txt` がGNU公式のAGPL-3.0全文である。
- `THIRD_PARTY_LICENSES/Vivliostyle-NOTICE.md` のViewerバージョン、`gitHead`、対応ソースURLが、実際に同梱するViewerと一致する。
- `src-tauri/tauri.conf.json` の `bundle.resources` にAGPL全文とVivliostyle告知が登録されている。
- `src-tauri/tauri.conf.json` の `bundle.targets` が `["nsis"]` であり、NSIS以外を新規生成しない。
- 生成したNSISインストーラーに `THIRD_PARTY_LICENSES/AGPL-3.0.txt` と `THIRD_PARTY_LICENSES/Vivliostyle-NOTICE.md` が含まれている。
- GitHub Releaseのインストーラーダウンロード案内の近くに、同梱版と対応するソースアーカイブへのリンクを掲載する。

Vivliostyle Viewer 2.43.3の対応ソース:

- Commit: `74048579bd3dde59a7a814bca6e9fd11760c6059`
- ZIP: https://github.com/vivliostyle/vivliostyle.js/archive/74048579bd3dde59a7a814bca6e9fd11760c6059.zip
- tar.gz: https://github.com/vivliostyle/vivliostyle.js/archive/74048579bd3dde59a7a814bca6e9fd11760c6059.tar.gz

Viewerを更新または改変した場合は、このチェックリスト、README、第三者ライセンス告知を同時に更新する。改変した場合は、改変内容、ビルド手順を含む完全な対応ソースをAGPL-3.0に従って提供する。
