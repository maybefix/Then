# -*- coding: utf-8 -*-
"""「異字同訓」の漢字の使い分け例（報告）から、Thenの手掛かり語データを作る。

文化審議会国語分科会『「異字同訓」の漢字の使い分け例（報告）』（平成26年2月21日）
のPDFを読み、項目・語義・用例を取り出す。用例はSudachiで解析し、どの語がどの表記
を選ばせているか（格の項・連体修飾の被修飾名詞・複合の隣接語・名詞を承ける述語）を
共起として集めて src/proofread/ijidokunData.ts を書き出す。

    py -3 -m pip install pymupdf
    .venv-nlp/Scripts/python.exe -m pip install pymupdf
    .venv-nlp/Scripts/python.exe scripts/nlp/build-ijidokun.py <報告のPDF>

PDFは文化庁のサイトで公開されている。
https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/93927001_12.pdf

出力は生成物なので手で直さない。報告に載っていない語を足すときは
src/proofread/ijidokunExtra.ts に書く。
"""
import collections
import json
import re
import sys
import unicodedata
from pathlib import Path

import fitz  # PyMuPDF
from sudachipy import Dictionary, SplitMode

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "src" / "proofread" / "ijidokunData.ts"

tok = Dictionary(dict="core").create()

CASE = ["が", "を", "に", "と", "へ", "から", "で"]
NOUN_POS = ("名詞", "接頭辞", "接尾辞")
# 手掛かりにすると誤検出が増える一般語。
STOP_WORDS = {"こと", "もの", "ため", "ところ", "よう", "ほう", "中", "上", "下", "方", "人",
              "それ", "これ", "あれ", "何", "など", "とき", "時", "者", "物", "事", "所"}
# 名詞の項目で、述語にしても意味を絞れない語。
STOP_PREDICATES = {"する", "ある", "なる", "いる", "できる", "行く", "来る", "言う", "見る", "思う", "いう"}
# 仮名書きの語はSudachiの正規化形（けが→怪我）で補う。逆向きは誤検出が増えるので
# 「喉」だけ手で足す。
MANUAL_ALIASES = {"喉": ["のど"]}

ITEM_NUMBER = re.compile(r"^[０-９]{3}$")


def pos(morpheme):
    return morpheme.part_of_speech()[0]


def read_report(pdf_path):
    """報告のPDFから、項目番号・読み・ページ・語義・用例を取り出す。"""
    document = fitz.open(pdf_path)
    entries = []
    current = None
    printed = None
    for page in document:
        lines = page.get_text().split("\n")
        heading = re.match(r"^- (\d+) -$", lines[0].strip())
        printed = int(heading.group(1)) if heading else printed
        for index, line in enumerate(lines):
            text = line.strip()
            if ITEM_NUMBER.match(text):
                current = {"no": unicodedata.normalize("NFKC", text),
                           "reading": lines[index - 1].strip() if index else "",
                           "page": printed, "variants": [], "notes": []}
                entries.append(current)
                continue
            if current is None:
                continue
            variant = re.match(r"^【(.+?)】(.*)$", text)
            if variant:
                current["variants"].append({"words": variant.group(1), "gloss": variant.group(2), "examples": []})
                continue
            if text.startswith("*") or text.startswith("＊"):
                current["notes"].append(text)
                continue
            if current["variants"] and text:
                # 巻末の項目一覧は語義も用例も持たないので、ここで拾っても後で落ちる。
                if current["notes"]:
                    current["notes"][-1] += text
                else:
                    current["variants"][-1]["examples"].append(text)
    return [entry for entry in entries if len(entry["variants"]) >= 2]


def noun_run_back(morphemes, end):
    start = end
    while start > 0 and pos(morphemes[start - 1]) in NOUN_POS:
        start -= 1
    return "".join(m.surface() for m in morphemes[start:end]) if start < end else None


def noun_run_forward(morphemes, start):
    end = start
    while end < len(morphemes) and pos(morphemes[end]) in NOUN_POS:
        end += 1
    return "".join(m.surface() for m in morphemes[start:end]) if end > start else None


def aliases(word):
    found = list(MANUAL_ALIASES.get(word, []))
    morphemes = list(tok.tokenize(word, SplitMode.C))
    if len(morphemes) == 1 and pos(morphemes[0]) == "名詞":
        normalized = morphemes[0].normalized_form()
        if normalized != word and normalized not in found:
            found.append(normalized)
    return found


def usable(word):
    if not word or word in STOP_WORDS:
        return False
    return len(word) > 1 or bool(re.match(r"[一-鿿々]", word))


def collect(entry):
    """1項目から、表記を選ばせている共起語を集める。"""
    variants = []
    for variant in entry["variants"]:
        heads = [re.sub(r"[*＊]+", "", head).strip() for head in variant["words"].split("・")]
        heads = [head for head in heads if head and len(head) <= 7 and not re.search(r"委員|分科|打合", head)]
        if not heads:
            continue
        gloss = re.sub(r"^（[^）]*）。?", "", variant["gloss"])
        sense = re.sub(r"[*＊]", "", re.split(r"[。（]", gloss)[0]).strip()
        variants.append({"heads": heads, "sense": sense, "examples": variant["examples"]})
    if len(variants) < 2:
        return None

    located_by_head = {head: (vi, hi) for vi, v in enumerate(variants) for hi, head in enumerate(v["heads"])}
    kind = "noun" if all(re.fullmatch(r"[一-鿿々]+", head) for v in variants for head in v["heads"]) else "predicate"
    raw = collections.defaultdict(set)
    for vi, variant in enumerate(variants):
        for sentence in filter(None, (s.strip() for s in re.split("。", "".join(variant["examples"])))):
            # 報告が注記（*）や併記（（　））を付けた用例は、報告自身が使い分けの
            # 分かれる例だと述べているので手掛かりにしない。
            if re.search(r"[*＊（）]", sentence):
                continue
            morphemes = list(tok.tokenize(sentence, SplitMode.C))
            for i, morpheme in enumerate(morphemes):
                located = located_by_head.get(morpheme.dictionary_form())
                if not located or located[0] != vi:
                    continue
                if kind == "predicate":
                    j = i - 1
                    while j >= 0 and pos(morphemes[j]) in ("副詞", "接続詞"):
                        j -= 1
                    if j >= 0 and pos(morphemes[j]) == "助詞" and morphemes[j].surface() in CASE:
                        word = noun_run_back(morphemes, j)
                        if usable(word):
                            raw[(morphemes[j].surface(), word)].add(located)
                    k = i + 1
                    while k < len(morphemes) and pos(morphemes[k]) == "助動詞":
                        k += 1
                    if k < len(morphemes) and pos(morphemes[k]) == "名詞":
                        word = noun_run_forward(morphemes, k)
                        if usable(word):
                            raw[("連体", word)].add(located)
                    continue
                if i > 0 and pos(morphemes[i - 1]) in ("名詞", "接頭辞") and usable(morphemes[i - 1].surface()):
                    raw[("前接", morphemes[i - 1].surface())].add(located)
                if i + 1 < len(morphemes) and pos(morphemes[i + 1]) in ("名詞", "接尾辞") and usable(morphemes[i + 1].surface()):
                    raw[("後接", morphemes[i + 1].surface())].add(located)
                if i + 2 < len(morphemes) and morphemes[i + 1].surface() == "の" and pos(morphemes[i + 2]) == "名詞" and usable(morphemes[i + 2].surface()):
                    raw[("の", morphemes[i + 2].surface())].add(located)
                if i + 2 < len(morphemes) and pos(morphemes[i + 1]) == "助詞" and morphemes[i + 1].surface() in CASE:
                    k = i + 2
                    while k < len(morphemes) and pos(morphemes[k]) == "副詞" and k < i + 4:
                        k += 1
                    if k < len(morphemes) and pos(morphemes[k]) in ("動詞", "形容詞"):
                        word = morphemes[k].dictionary_form()
                        if word not in STOP_PREDICATES:
                            raw[("述語" + morphemes[i + 1].surface(), word)].add(located)

    # 同じ語が同じ項目の複数の表記に現れるものは、関係が違っても決め手にならない。
    spellings = collections.defaultdict(set)
    for (_, word), found in raw.items():
        spellings[word] |= {variant for variant, _ in found}
    cues = [{"r": role, "w": word, "v": next(iter(found))[0], "h": next(iter(found))[1]}
            for (role, word), found in raw.items()
            if len(found) == 1 and len(spellings[word]) == 1]
    known = {cue["w"] for cue in cues}
    for cue in list(cues):
        for alias in aliases(cue["w"]):
            if alias in known or not usable(alias):
                continue
            known.add(alias)
            cues.append({**cue, "w": alias})
    if not cues:
        return None
    return {"no": entry["no"], "reading": entry["reading"], "page": entry["page"], "kind": kind,
            "variants": [{"heads": v["heads"], "sense": v["sense"]} for v in variants],
            "cues": sorted(cues, key=lambda cue: (cue["v"], cue["r"], cue["w"]))}


HEADER = '''/**
 * 「異字同訓」の漢字の使い分け例（文化審議会国語分科会・平成26年2月21日報告）の
 * 全項目から起こした、表記を選ぶ手掛かり語の一覧。
 *
 * 語義は報告の説明を短くまとめたもの、手掛かり語は報告の用例を形態素解析して
 * 取り出した共起語である。報告が注記（*）や併記（（　））を付けた用例は、
 * 使い分けが分かれると報告自身が述べているため手掛かりにしていない。同じ語が
 * 同じ項目の複数の表記に現れる場合も、決め手にならないので除いてある。
 *
 * scripts/nlp/build-ijidokun.py で生成する。手で直さない。報告に載っていない語は
 * この表に足さず、ijidokunExtra.ts に分けて置く。
 */

/** 手掛かり語と対象語の関係。 */
export type IjidokunRole =
  /** 対象語（動詞・形容詞）の項。「期待に応える」の「期待」。 */
  | "が" | "を" | "に" | "と" | "へ" | "から" | "で"
  /** 対象語が連体修飾する名詞。「熱い湯」の「湯」。 */
  | "連体"
  /** 対象語（名詞）を承ける述語。「足が出る」の「出る」。 */
  | "述語が" | "述語を" | "述語に" | "述語と" | "述語で" | "述語から"
  /** 対象語（名詞）に接する語。「立つ鳥跡」の「鳥」、「革ジャンパー」の「ジャンパー」。 */
  | "前接" | "後接"
  /** 「足の裏」のように「の」で続く名詞。 */
  | "の";

/** [関係, 手掛かり語, その語が示す表記の番号, その用例で使われていた見出しの番号]。 */
export type IjidokunCue = [IjidokunRole, string, number, number];

export type IjidokunVariant = {
  /** 同じ語義に属する見出し。活用語は終止形。例: ["直す", "直る"] */
  heads: string[];
  /** 報告の語義を短くまとめたもの。 */
  sense: string;
};

export type IjidokunGroup = {
  /** 報告の項目番号。検出項目のIDに使う。 */
  no: string;
  /** 項目の読み。 */
  reading: string;
  /** 報告本文のページ。 */
  page: number;
  /** 活用する語か、名詞か。文脈の見方が変わる。 */
  kind: "predicate" | "noun";
  variants: IjidokunVariant[];
  cues: IjidokunCue[];
};

export const IJIDOKUN_GROUPS: IjidokunGroup[] = ['''


def emit(groups):
    def quote(value):
        return json.dumps(value, ensure_ascii=False)

    lines = [HEADER]
    for group in groups:
        variants = ", ".join(
            "{ heads: [%s], sense: %s }" % (", ".join(quote(head) for head in v["heads"]), quote(v["sense"]))
            for v in group["variants"]
        )
        cues = ", ".join("[%s, %s, %d, %d]" % (quote(c["r"]), quote(c["w"]), c["v"], c["h"]) for c in group["cues"])
        lines.append('  { no: %s, reading: %s, page: %d, kind: "%s",\n    variants: [%s],\n    cues: [%s] },'
                     % (quote(group["no"]), quote(group["reading"]), group["page"], group["kind"], variants, cues))
    lines.append("];")
    lines.append("")
    OUTPUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    entries = read_report(sys.argv[1])
    groups = [group for group in (collect(entry) for entry in entries) if group]
    emit(groups)
    dropped = sorted({entry["no"] for entry in entries} - {group["no"] for group in groups})
    print(f"項目 {len(entries)} 件のうち {len(groups)} 件を出力（手掛かり語 {sum(len(g['cues']) for g in groups)} 語）")
    print(f"手掛かり語が取れず落とした項目: {', '.join(dropped) or 'なし'}")
    print(f"→ {OUTPUT}")


if __name__ == "__main__":
    main()
