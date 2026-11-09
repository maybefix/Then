import type { Dispatch, SetStateAction } from "react";
import type { CanvasCopyToPlotRequest } from "./canvasTypes";
import { renumberPlotCards } from "./components/plot/plotCardUtils";
import { loadWorkspacePlotCards, saveWorkspacePlotCards } from "./plotCardModel";
import type { PlotCard } from "./types";
import { plotCardReferencePaths, rewritePlotCard, type ReferenceRewrite } from "./utils/libraryTransfer";

type TransferOptions = { target: string; targetLabel: string; move: boolean; copyReferences: boolean };

export type PlotCardActionDeps = {
  plotCards: PlotCard[];
  setPlotCards: Dispatch<SetStateAction<PlotCard[]>>;
  requestTransferOptions: (request: {
    itemLabel: string;
    referenceCount: number;
    canMove?: boolean;
  }) => Promise<TransferOptions | null>;
  isExistingReference: (path: string) => boolean;
  prepareReferenceRewrite: (
    targetPath: string,
    referencedPaths: string[],
    copyReferences: boolean,
  ) => Promise<ReferenceRewrite>;
  showToast: (message: string) => void;
  reportTransferError: (error: unknown) => void;
  setRightSidebarTab: (tab: string) => void;
  setIsRightSidebarCollapsed: (collapsed: boolean) => void;
};

/**
 * Plot のカードを作品の外とやり取りする操作（作品間の移動・コピー、Canvas からの受け取り）。
 * 値は App が持ち、描画のたびにその時点の値と書き換え用の関数を受け取る。
 */
export function createPlotCardActions(deps: PlotCardActionDeps) {
  const {
    plotCards,
    setPlotCards,
    requestTransferOptions,
    isExistingReference,
    prepareReferenceRewrite,
    showToast,
    reportTransferError,
    setRightSidebarTab,
    setIsRightSidebarCollapsed,
  } = deps;

  const transferPlotCard = async (cardId: string) => {
    const card = plotCards.find((item) => item.id === cardId);
    if (!card) return;
    const referencedPaths = plotCardReferencePaths([card]);
    const options = await requestTransferOptions({
      itemLabel: card.kind === "chapter" ? "章ラベル" : "プロット",
      referenceCount: referencedPaths.filter(isExistingReference).length,
    });
    if (!options) return;
    try {
      const rewrite = await prepareReferenceRewrite(options.target, referencedPaths, options.copyReferences);
      const targetCards = await loadWorkspacePlotCards(options.target);
      await saveWorkspacePlotCards(options.target, [
        ...targetCards,
        { ...rewritePlotCard(card, rewrite), id: crypto.randomUUID() },
      ]);
      if (options.move) setPlotCards((current) => current.filter((item) => item.id !== cardId));
      showToast(`${options.targetLabel}へ${options.move ? "移動" : "コピー"}しました`);
    } catch (error) {
      reportTransferError(error);
    }
  };

  /** Canvas の「プロットへ送る」（then-canvas-copy-to-plot）の受け取り。登録は App の useEffect に残す。 */
  const receiveCanvasCopyToPlot = (event: { payload: CanvasCopyToPlotRequest }) => {
    const items = event.payload.items.filter((item) => item.text.trim().length > 0);
    if (items.length === 0) return;

    const stamp = Date.now().toString(36);
    setPlotCards((current) =>
      renumberPlotCards([
        ...current,
        ...items.map((item, index) => {
          // 複数行のカードは1行目をタイトル、残りを本文に。1行だけなら本文のみ。
          const lines = item.text.trim().split("\n");
          const [firstLine, ...rest] = lines;
          const title = lines.length > 1 ? firstLine.trim() : "";
          const body = lines.length > 1 ? rest.join("\n").trim() : firstLine.trim();
          return {
            id: `plot-${stamp}-${index}`,
            kind: "section" as const,
            num: "",
            title,
            body,
            expanded: false,
            managerCollapsed: false,
          };
        }),
      ]),
    );
    setRightSidebarTab("plot");
    setIsRightSidebarCollapsed(false);
    showToast(`${items.length} 件をプロットへ追加しました`);
  };

  return { transferPlotCard, receiveCanvasCopyToPlot };
}
