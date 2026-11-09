import { useModalFocus } from "./useModalFocus";
import "./help.css";

export function HelpModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalFocus(onClose);

  return (
    <div className="modalBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="modal helpModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
      >
        <header className="modalHeader">
          <h2 id="help-title">基本の操作</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="helpBody" tabIndex={0} aria-label="操作の説明">
          <section>
            <h3>作品と原稿を作る</h3>
            <p>ライブラリは、作品をまとめて置くフォルダです。「＋ 新しい作品」で作品を作り、開きます。左側の「＋」か、左上のメニューの「新規ファイル」で原稿を作れます。</p>
            <p>手元の原稿を開くときは、左上のメニューから「ファイルを開く」を選びます。</p>
          </section>
          <section>
            <h3>保存する</h3>
            <p>本文は自動保存されます。保存先がまだない原稿は、左上のメニューで「保存」を選び、名前と保存先を決めます。保存状態は画面下部に表示されます。</p>
          </section>
          <section>
            <h3>縦書き・文字の大きさを変える</h3>
            <p>縦書きと横書きは、画面上部の切替ボタンで変えられます。フォントや文字サイズ、行間は、歯車の「設定」→「本文」で変更します。</p>
          </section>
          <section>
            <h3>ルビを振る</h3>
            <p>文字を選択して <kbd>Ctrl</kbd> + <kbd>P</kbd> を押し、「ルビ」を検索して選びます。読みを入力すると、選択した文字にルビが付きます。</p>
          </section>
          <section>
            <h3>本文を検索する・操作を探す</h3>
            <p><kbd>Ctrl</kbd> + <kbd>F</kbd> で、開いている原稿の中を検索します。操作を名前で探すときは <kbd>Ctrl</kbd> + <kbd>P</kbd> を使います。</p>
          </section>
          <section>
            <h3>PDF・Wordに書き出す</h3>
            <p>左上のメニューから「エクスポート」を開きます。書き出す原稿と出力形式を選び、用紙や文字の設定を確認して書き出します。</p>
          </section>
        </div>
      </section>
    </div>
  );
}
