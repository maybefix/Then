# リリースチェックリスト

## 第三者ライセンス

Thenのインストーラーを公開する前に、次を確認する。

- `THIRD_PARTY_LICENSES/AGPL-3.0.txt` がGNU公式のAGPL-3.0全文である。
- `THIRD_PARTY_LICENSES/Vivliostyle-NOTICE.md` のViewerバージョン、`gitHead`、対応ソースURLが、実際に同梱するViewerと一致する。
- `src-tauri/tauri.conf.json` の `bundle.resources` にAGPL全文とVivliostyle告知が登録されている。
- 生成したMSI / NSISインストーラーに `THIRD_PARTY_LICENSES/AGPL-3.0.txt` と `THIRD_PARTY_LICENSES/Vivliostyle-NOTICE.md` が含まれている。
- GitHub Releaseのインストーラーダウンロード案内の近くに、同梱版と対応するソースアーカイブへのリンクを掲載する。

Vivliostyle Viewer 2.43.3の対応ソース:

- Commit: `74048579bd3dde59a7a814bca6e9fd11760c6059`
- ZIP: https://github.com/vivliostyle/vivliostyle.js/archive/74048579bd3dde59a7a814bca6e9fd11760c6059.zip
- tar.gz: https://github.com/vivliostyle/vivliostyle.js/archive/74048579bd3dde59a7a814bca6e9fd11760c6059.tar.gz

Viewerを更新または改変した場合は、このチェックリスト、README、第三者ライセンス告知を同時に更新する。改変した場合は、改変内容、ビルド手順を含む完全な対応ソースをAGPL-3.0に従って提供する。
