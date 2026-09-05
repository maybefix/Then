import { isRangeMasked, maskSurfaces, sentenceLength } from "./context";
import { collectRubyAnnotations } from "./ruby";
import { homophoneRule } from "./homophones";
import { ijidokunRule } from "./ijidokun";
import { topicPredicateRule } from "./topicPredicate";
import {
  ESTABLISHED_DOUBLE_HONORIFICS,
  IDIOM_FORMS,
  IDIOM_MEANINGS,
  MIMIZAWARI_PATTERNS,
  NARARERU_ENDINGS,
} from "./misuseData";
import {
  GAIRAIGO,
  HYOKI_RULEBOOK,
  JIS_X_4051,
  JOYO_KANJI,
  JTF_STYLE,
  KANJI_SHIYO,
  KEIGO_SHISHIN,
  KISHA_HANDBOOK,
  KOKUGO_YORON,
  KOTOBA_SHOKUDO,
  KOYOBUN,
  OKURIGANA,
} from "./sources";
import type { ProofreadContext, ProofreadHit, ProofreadRule } from "./types";

/** 1つのルールが返す指摘の上限。長い原稿で同じ指摘が並び続けるのを防ぐ。 */
const MAX_HITS_PER_RULE = 200;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Substitution = {
  pattern: RegExp;
  message: string;
  /** 観点ごとに止められる項目のID。 */
  checkId?: string;
  /** 当たった中から指摘に残すものを選ぶ。省くと全部残す。 */
  accept?: (match: RegExpExecArray) => boolean;
  /** 置き換え候補。曖昧なものは undefined を返して指摘だけにする。 */
  replace?: (match: RegExpExecArray) => string | undefined;
  detail?: string;
};

/**
 * パターンを順に当てて指摘を作る。呼び出しごとに正規表現を作り直し、
 * モジュールレベルの定数が lastIndex を持ち越さないようにする。
 */
function collectMatches(text: string, entries: Substitution[]): ProofreadHit[] {
  const hits: ProofreadHit[] = [];

  for (const entry of entries) {
    const flags = entry.pattern.flags.includes("g")
      ? entry.pattern.flags
      : `${entry.pattern.flags}g`;
    const pattern = new RegExp(entry.pattern.source, flags);

    let match = pattern.exec(text);
    while (match && hits.length < MAX_HITS_PER_RULE) {
      if (entry.accept && !entry.accept(match)) {
        if (match[0].length === 0) pattern.lastIndex += 1;
        match = pattern.exec(text);
        continue;
      }
      const replacement = entry.replace?.(match);
      hits.push({
        ...(entry.checkId ? { checkId: entry.checkId } : {}),
        from: match.index,
        to: match.index + match[0].length,
        message: entry.message,
        ...(replacement !== undefined && replacement !== match[0] ? { replacement } : {}),
        ...(entry.detail ? { detail: entry.detail } : {}),
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
      match = pattern.exec(text);
    }
  }

  return hits;
}

// ---------------------------------------------------------------------------
// 1. 話し言葉の混入
// ---------------------------------------------------------------------------

/**
 * ら抜きになりうる上一段・下一段・カ変動詞の語幹。
 * 五段動詞から作る可能動詞（切れる・取れるなど）は正しい形なので入れない。
 */
const RA_NUKI_STEMS = [
  "見",
  "観",
  "出",
  "来",
  "着",
  "寝",
  "起き",
  "降り",
  "借り",
  "足り",
  "過ぎ",
  "生き",
  "落ち",
  "信じ",
  "感じ",
  "覚え",
  "教え",
  "答え",
  "考え",
  "決め",
  "始め",
  "続け",
  "届け",
  "投げ",
  "逃げ",
  "開け",
  "閉め",
  "見せ",
  "混ぜ",
  "調べ",
  "食べ",
  "比べ",
  "並べ",
  "求め",
  "集め",
  "認め",
  "助け",
  "分け",
  "避け",
];

/** 仮定形「〜れば」は正しい形なので語尾から外す。 */
const RA_NUKI_SUFFIXES = ["る", "た", "ます", "まし", "ません", "ない", "なかっ", "なく", "て", "よう"];

const RA_NUKI_PATTERN = new RegExp(
  `(${RA_NUKI_STEMS.join("|")})れ(${RA_NUKI_SUFFIXES.join("|")})`,
  "g",
);

/** 「〜させていただく」に余分な「さ」が入る、いわゆるさ入れ言葉。 */
const SA_IRE_PATTERN =
  /(行か|読ま|書か|飲ま|話さ|休ま|使わ|作ら|帰ら|送ら|待た|歌わ|やら|置か|泊ま|伺わ)させて/g;

const KURU_FORMS: Record<string, string> = {
  る: "くる",
  た: "きた",
  て: "きて",
  ます: "きます",
  ない: "こない",
};

const colloquialRule: ProofreadRule = {
  id: "colloquial",
  name: "話し言葉の混入",
  summary:
    "ら抜き言葉・い抜き言葉・さ入れ言葉など、書き言葉では避けたい形を拾う。会話文は既定で対象外。",
  severity: "should",
  target: "common",
  respectsDialogue: true,
  wordScoped: true,
  sources: [KOKUGO_YORON],
  scan: (context) =>
    collectMatches(context.narrationText, [
      {
        pattern: RA_NUKI_PATTERN,
        message: "ら抜き言葉です。可能の意味なら「られる」の形にします。",
        replace: (match) => `${match[1]}られ${match[2]}`,
      },
      {
        pattern: /して(る|た|ます|まし|ない|なかっ)/g,
        message: "い抜き言葉です。「〜ている」の「い」を補います。",
        replace: (match) => `してい${match[1]}`,
      },
      {
        pattern: /って(る|た|ます|まし|ない|なかっ)/g,
        message: "い抜き言葉です。「〜ている」の「い」を補います。",
        replace: (match) => `ってい${match[1]}`,
      },
      {
        // 「なんてない」のように、ん の前が仮名の場合はい抜きではないので外す。
        pattern: /(?<=[一-龥])んで(る|た|ます|まし|ない|なかっ)/g,
        message: "い抜き言葉です。「〜ている」の「い」を補います。",
        replace: (match) => `んでい${match[1]}`,
      },
      {
        pattern: SA_IRE_PATTERN,
        message: "さ入れ言葉です。五段動詞には「させて」ではなく「せて」が付きます。",
        replace: (match) => `${match[1]}せて`,
      },
      {
        pattern: /(^|\n)([ 　]*)なので/g,
        message: "文頭の「なので」は話し言葉です。「そのため」「したがって」に置き換えます。",
        replace: (match) => `${match[1]}${match[2]}そのため`,
      },
      {
        // 「やってみたい」の「みたい」は補助動詞なので、直前が「て」「で」なら数えない。
        pattern: /(?<![てで])みたい(な|に|だ|で)/g,
        message: "「みたいな」は話し言葉です。「のような」「のように」を検討します。",
      },
      {
        pattern: /じゃな(い|かっ|く)/g,
        message: "「じゃない」は話し言葉です。書き言葉では「ではない」を使います。",
        replace: (match) => `ではな${match[1]}`,
      },
      {
        pattern: /(っ|し|ん)(ちゃ|じゃ)(う|っ|い|お)/g,
        message: "「〜ちゃう」「〜じゃう」は話し言葉です。「〜てしまう」に改めます。",
      },
    ]),
};

// ---------------------------------------------------------------------------
// 2. 漢字を開く（補助動詞・形式名詞・副詞）
// ---------------------------------------------------------------------------

/** 単独の副詞として使われているときだけ拾うための前後の囲い。 */
const adverb = (kanji: string, kana: string, trailing = ""): Substitution => ({
  pattern: new RegExp(`(?<![一-龥])${kanji}${trailing}(?![一-龥々])`, "g"),
  message: `副詞・接続詞の「${kanji}${trailing}」は仮名で書きます。`,
  replace: () => `${kana}${trailing}`,
});

const kanjiOpeningRule: ProofreadRule = {
  id: "kanji-opening",
  name: "漢字を開く",
  summary:
    "補助動詞・形式名詞・副詞など、公用文では仮名で書くことになっている語が漢字のまま残っていないかを見る。",
  severity: "should",
  target: "article",
  respectsDialogue: true,
  wordScoped: true,
  sources: [KANJI_SHIYO, JOYO_KANJI],
  scan: (context) =>
    collectMatches(context.narrationText, [
      {
        pattern: /出来(る|た|ず|ない|なかっ|なく|ます|まし|れば|よう)/g,
        message: "「出来る」は仮名で書きます。",
        replace: (match) => `でき${match[1]}`,
      },
      {
        pattern: /([てで])下さい/g,
        message: "補助動詞の「ください」は仮名で書きます。",
        replace: (match) => `${match[1]}ください`,
      },
      {
        pattern: /て頂(く|き|け|い|こ)/g,
        message: "補助動詞の「いただく」は仮名で書きます。",
        replace: (match) => `ていただ${match[1]}`,
      },
      {
        pattern: /て置(く|き|け|い|こ)/g,
        message: "補助動詞の「おく」は仮名で書きます。",
        replace: (match) => `てお${match[1]}`,
      },
      {
        pattern: /て行(く|き|け|こ|っ)/g,
        message: "補助動詞の「いく」は仮名で書きます。",
        replace: (match) => `てい${match[1]}`,
      },
      {
        pattern: /て来(る|た|て|ます|ない)/g,
        message: "補助動詞の「くる」は仮名で書きます。",
        replace: (match) => `て${KURU_FORMS[match[1]] ?? ""}`,
      },
      {
        // 「初めて見る」は本動詞の「見る」。補助動詞ではないので外す。
        pattern: /(?<!初め)て見(る|た|て|よう|ます|ない)/g,
        message: "補助動詞の「みる」は仮名で書きます。",
        replace: (match) => `てみ${match[1]}`,
      },
      {
        pattern: /([てで])良(い|かっ|く)/g,
        message: "補助形容詞の「よい」は仮名で書きます。",
        replace: (match) => `${match[1]}よ${match[2]}`,
      },
      {
        pattern: /([はでく])無(い|く|かっ)/g,
        message: "補助形容詞の「ない」は仮名で書きます。",
        replace: (match) => `${match[1]}な${match[2]}`,
      },
      {
        pattern: /有(る|ります|らない)/g,
        message: "「ある」は仮名で書きます。",
        replace: (match) => `あ${match[1]}`,
      },
      {
        // 前が仮名の活用語尾のときだけ形式名詞とみなす。「仕事」「返事」のような
        // 熟語は前が漢字なので当たらない。
        pattern: /(?<=[うくすつぬぶむるいたなの])事(?![一-龥々])/g,
        message: "形式名詞の「こと」は仮名で書きます。",
        replace: () => "こと",
      },
      {
        pattern: /(?<=[うくすつぬぶむるいたなの])為(?![一-龥々])/g,
        message: "形式名詞の「ため」は仮名で書きます。",
        replace: () => "ため",
      },
      {
        pattern: /(という|する|した|の)訳(?![一-龥々])/g,
        message: "形式名詞の「わけ」は仮名で書きます。",
        replace: (match) => `${match[1]}わけ`,
      },
      {
        pattern: /(する|した|しない|ある|ない|の)筈/g,
        message: "形式名詞の「はず」は仮名で書きます。",
        replace: (match) => `${match[1]}はず`,
      },
      {
        pattern: /(する|した|という|この|その)様(?![一-龥々])/g,
        message: "形式名詞の「よう」は仮名で書きます。",
        replace: (match) => `${match[1]}よう`,
      },
      {
        pattern: /(という|する|した)物(?![一-龥々])/g,
        message: "形式名詞の「もの」は仮名で書きます。",
        replace: (match) => `${match[1]}もの`,
      },
      adverb("更", "さら", "に"),
      adverb("既", "すで", "に"),
      adverb("全", "すべ", "て"),
      adverb("但", "ただ", "し"),
      adverb("殆", "ほとん", "ど"),
      adverb("丁度", "ちょうど"),
      adverb("沢山", "たくさん"),
      adverb("何故", "なぜ"),
      adverb("予", "あらかじ", "め"),
      adverb("或", "ある", "いは"),
      adverb("全", "まった", "く"),
      adverb("敢", "あ", "えて"),
      adverb("様々", "さまざま"),
      adverb("色々", "いろいろ"),
      {
        pattern: /(?<![一-龥])尚(?![一-龥々])/g,
        message: "接続詞の「なお」は仮名で書きます。",
        replace: () => "なお",
      },
      {
        pattern: /(?<![一-龥])又(?!は)(?![一-龥々])/g,
        message: "副詞の「また」は仮名で書きます（接続詞「又は」は除く）。",
        replace: () => "また",
      },
      {
        pattern: /(?<![一-龥])等(?![一-龥々しく])/g,
        message: "「など」は仮名で書きます。",
        replace: () => "など",
      },
    ]),
};

// ---------------------------------------------------------------------------
// 3. 一文の長さと読点
// ---------------------------------------------------------------------------

/**
 * 名詞をつなぐ「の」だけを拾うための前後の条件。漢字・片仮名に挟まれた
 * ものに限ることで、「〜ので」「〜のに」「この」「その」「もの」や、
 * 「書くのが」のような準体助詞を数えない。建議が例に挙げているのは
 * 「本年の当課の取組の中心は」のような名詞の連なりなので、そこへ寄せる。
 */
const GENITIVE_NEIGHBOR = /[一-龥ァ-ヴー々]/;

/** 名詞をつなぐ「の」が近い間隔で3回続く箇所を返す。 */
function findGenitiveChains(sentence: string, span: number): [number, number][] {
  const positions: number[] = [];
  for (let index = 1; index + 1 < sentence.length; index += 1) {
    if (sentence[index] !== "の") continue;
    if (!GENITIVE_NEIGHBOR.test(sentence[index - 1])) continue;
    if (!GENITIVE_NEIGHBOR.test(sentence[index + 1])) continue;
    positions.push(index);
  }

  const chains: [number, number][] = [];
  let cursor = 0;
  while (cursor + 2 < positions.length) {
    const [first, second, third] = [positions[cursor], positions[cursor + 1], positions[cursor + 2]];
    if (second - first <= span && third - second <= span) {
      chains.push([first, third + 1]);
      cursor += 3;
      continue;
    }
    cursor += 1;
  }
  return chains;
}

const sentenceRule: ProofreadRule = {
  id: "sentence-flow",
  name: "一文の長さと読点",
  summary:
    "一文が長すぎないか、読点が多すぎないか、助詞の「の」が続いていないかを文ごとに見る。",
  severity: "hint",
  target: "common",
  respectsDialogue: true,
  wordScoped: false,
  sources: [KOYOBUN],
  scan: (context) => {
    const hits: ProofreadHit[] = [];
    const { maxSentenceLength, maxCommasPerSentence } = context.options;

    for (const sentence of context.sentences) {
      if (hits.length >= MAX_HITS_PER_RULE) break;
      if (isRangeMasked(context.narrationText, sentence.from, sentence.to)) continue;

      const length = sentenceLength(sentence.text);
      if (length > maxSentenceLength) {
        hits.push({
          from: sentence.from,
          to: sentence.to,
          message: `一文が${length}字あります（目安は${maxSentenceLength}字）。`,
          detail: "文を分けるか、修飾のかかり先を整理すると読みやすくなります。",
        });
      }

      const commas = (sentence.text.match(/、/g) ?? []).length;
      if (commas > maxCommasPerSentence) {
        hits.push({
          from: sentence.from,
          to: sentence.to,
          message: `読点が${commas}個あります（目安は${maxCommasPerSentence}個）。`,
          detail: "読点で節をつなぎ続けている可能性があります。文を切ることを検討します。",
        });
      }

      for (const [from, to] of findGenitiveChains(sentence.text, 8)) {
        hits.push({
          from: sentence.from + from,
          to: sentence.from + to,
          message: "助詞の「の」が3回続いています。",
          detail: "名詞を動詞に開くか、語順を変えると係り受けがはっきりします。",
        });
      }
    }

    return hits;
  },
};

// ---------------------------------------------------------------------------
// 4. 重複表現・冗長表現
// ---------------------------------------------------------------------------

/** 同じ意味を重ねている言い回し。置き換え先が一意に決まるものだけ入れる。 */
const DUPLICATED_EXPRESSIONS: [string, string][] = [
  ["まず最初に", "まず"],
  ["一番最初", "最初"],
  ["一番最後", "最後"],
  ["今の現状", "現状"],
  ["従来から", "従来"],
  ["古来から", "古来"],
  ["あらかじめ予約", "予約"],
  ["後で後悔", "後悔"],
  ["まだ未定", "未定"],
  ["いまだに未解決", "未解決"],
  ["炎天下の下", "炎天下"],
  ["元旦の朝", "元旦"],
  ["各国ごと", "国ごと"],
  ["過半数を超え", "半数を超え"],
  ["違和感を感じ", "違和感を覚え"],
  ["被害を被", "被害を受け"],
  ["返事を返", "返事をし"],
  ["日本に来日", "来日"],
  ["射程距離", "射程"],
  ["排気ガス", "排ガス"],
  ["約束を確約", "確約"],
  ["思いがけないハプニング", "ハプニング"],
  ["一堂に会して集ま", "一堂に会し"],
  ["頭痛が痛", "頭が痛"],
];

const redundancyRule: ProofreadRule = {
  id: "redundancy",
  name: "重複表現・冗長表現",
  summary: "意味の重なった言い回し、回りくどい言い方、二重否定を拾う。",
  severity: "should",
  target: "common",
  respectsDialogue: true,
  wordScoped: true,
  sources: [KISHA_HANDBOOK, KOYOBUN],
  scan: (context) =>
    collectMatches(context.narrationText, [
      ...DUPLICATED_EXPRESSIONS.map<Substitution>(([wrong, right]) => ({
        pattern: new RegExp(wrong, "g"),
        message: `「${wrong}」は意味が重なっています。`,
        replace: () => right,
      })),
      {
        pattern: /することができ(る|た|ない|ます|なかっ)/g,
        message: "「することができる」は「できる」に縮められます。",
        replace: (match) => `でき${match[1]}`,
      },
      {
        pattern: /することが可能(です|だ|で|な)/g,
        message: "「することが可能」は「できる」に言い換えられます。",
      },
      {
        pattern: /という形で/g,
        message: "「という形で」は意味を持たないことが多い表現です。",
      },
      {
        pattern: /を行(う|い|っ|わ)/g,
        message: "「〜を行う」はサ変動詞ひとつで書けることがあります。",
        detail: "「調査を行う」→「調査する」のように縮められないか確かめます。",
      },
      {
        // 「危なくない」のような形容詞の否定と紛れないよう、前に「ない」が
        // 立っている形だけを二重否定として拾う。
        pattern: /ない(?:わけ|こと)(?:で)?(?:は|も|が)な(い|かっ|く)/g,
        message: "二重否定です。肯定の形で言い切れないか検討します。",
      },
      {
        pattern: /ずには(いられ|おか)な(い|かっ)/g,
        message: "二重否定です。肯定の形で言い切れないか検討します。",
      },
      {
        pattern: /ないとは(?:(?:言|い)え|限ら)な(い|かっ)/g,
        message: "二重否定です。肯定の形で言い切れないか検討します。",
      },
    ]),
};

// ---------------------------------------------------------------------------
// 5. 約物の使い方
// ---------------------------------------------------------------------------

/**
 * 行の中で閉じていない鉤括弧を探す。会話文は行単位で閉じるのが普通なので、
 * 行をまたいだ対応は数えない。閉じ忘れは読み手が話者を見失う原因になる。
 */
function findUnbalancedQuotes(context: ProofreadContext): ProofreadHit[] {
  const hits: ProofreadHit[] = [];
  const lines = context.scanText.split("\n");
  let offset = 0;

  for (const line of lines) {
    const openings: number[] = [];
    const strays: number[] = [];
    let hasOpening = false;
    let hasClosing = false;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === "「" || character === "『") {
        hasOpening = true;
        openings.push(index);
        continue;
      }
      if (character !== "」" && character !== "』") continue;
      hasClosing = true;
      if (openings.length) {
        openings.pop();
        continue;
      }
      strays.push(index);
    }

    /*
     * 長い台詞は段落をまたぎ、続く段落の行頭に「を置いて閉じず、最後の段落で
     * 」だけを置く書き方が通例。片方しか無い行はその書き方とみなして咎めない。
     * 開き括弧と閉じ括弧の両方がある行だけを、対応の崩れとして拾う。
     */
    if (hasOpening && hasClosing) {
      for (const index of [...openings, ...strays]) {
        hits.push({
          from: offset + index,
          to: offset + index + 1,
          message: "同じ行の中で括弧の対応が取れていません。",
        });
      }
    }

    offset += line.length + 1;
  }

  return hits.slice(0, MAX_HITS_PER_RULE);
}

const punctuationRule: ProofreadRule = {
  id: "punctuation",
  name: "約物の使い方",
  summary:
    "三点リーダーとダッシュの個数、閉じ括弧の前の句点、感嘆符の後の空き、半角約物の混入を見る。",
  severity: "should",
  target: "novel",
  respectsDialogue: false,
  wordScoped: true,
  sources: [HYOKI_RULEBOOK, JIS_X_4051, JTF_STYLE],
  scan: (context) => [
    ...findUnbalancedQuotes(context),
    ...collectMatches(context.scanText, [
      {
        pattern: /…+/g,
        message: "三点リーダーは2つ1組（……）で使います。",
        accept: (match) => match[0].length % 2 === 1,
        replace: (match) => `${match[0]}…`,
      },
      {
        pattern: /・{2,}|\.{2,}/g,
        message: "中黒やピリオドの連続ではなく三点リーダー（……）を使います。",
        replace: () => "……",
      },
      {
        pattern: /―+/g,
        message: "ダッシュは2つ1組（――）で使います。",
        accept: (match) => match[0].length % 2 === 1,
        replace: (match) => `${match[0]}―`,
      },
      {
        // 「2020–2024」のような欧文の範囲指定には触れない。
        pattern: /(?<![0-9A-Za-z])[—–]+(?![0-9A-Za-z])/g,
        message: "全角ダッシュ（―）ではない記号が使われています。",
        replace: () => "――",
      },
      {
        pattern: /。(?=[」』）])/g,
        message: "閉じ括弧の前の句点は省くのが出版の慣行です。",
        replace: () => "",
      },
      {
        pattern: /([！？])(?![！？」』）】〉》\s（「『【〈《]|$)/gm,
        message: "文末の感嘆符・疑問符の後に別の文が続くときは、直後を1文字分空けます。",
        detail:
          "JTFスタイルガイド3.2.1。「おおっ！という声が上がりました。」のように引用の形で文中に使う場合は空けません。",
        replace: (match) => `${match[1]}　`,
      },
      {
        pattern: /(?<=[ぁ-んァ-ヴ一-龥ー])[!?]/g,
        message: "日本語の文中では全角の「！」「？」を使います。",
        replace: (match) => (match[0] === "!" ? "！" : "？"),
      },
      {
        pattern: /\([^)\n]*[ぁ-んァ-ヴ一-龥][^)\n]*\)/g,
        message: "日本語を囲む括弧は全角（　）を使います。",
        replace: (match) => `（${match[0].slice(1, -1)}）`,
      },
      {
        // JTFスタイルガイド3.2.5。範囲を示す波線は全角で、半角チルダは使わない。
        pattern: /~/g,
        message: "半角チルダは使いません。範囲を示す波線には全角を使います。",
        replace: () => "〜",
      },
    ]),
  ],
};

// ---------------------------------------------------------------------------
// 6. 表記のゆれ
// ---------------------------------------------------------------------------

const KANJI_CHARACTER = /[一-龥]/;

/**
 * 表記のゆれの検出項目。全角と半角の扱いは書き方の流儀が分かれるため、
 * ルールごと止めなくても観点だけ外せるようにする。縦組の本文で数字を
 * 全角に揃える、半角語の前後を空けて読みやすくする、といった書き方は
 * それ自体が誤りではない。
 */
const NOTATION_CHECKS = {
  okurigana: "notation-variants/okurigana",
  digits: "notation-variants/width-digits",
  alphabet: "notation-variants/width-alphabet",
  space: "notation-variants/width-space",
} as const;

/** 同じ語の書き分け。先頭を推奨表記として、数が並んだときの寄せ先にする。 */
const VARIANT_GROUPS: string[][] = [
  ["引っ越し", "引越し", "引越"],
  ["打ち合わせ", "打合せ", "打ち合せ"],
  ["問い合わせ", "問合せ"],
  ["申し込み", "申込み", "申込"],
  ["受け付け", "受付け"],
  ["取り扱い", "取扱い", "取扱"],
  ["差し支え", "差支え"],
  ["手続き", "手続"],
  ["話し合い", "話合い"],
  ["組み立て", "組立て", "組立"],
  ["見積もり", "見積り", "見積"],
  ["子ども", "子供"],
  ["行う", "行なう"],
  ["サーバー", "サーバ"],
  ["ユーザー", "ユーザ"],
  ["コンピューター", "コンピュータ"],
  ["ブラウザー", "ブラウザ"],
  ["プリンター", "プリンタ"],
  ["メモリー", "メモリ"],
  ["ドライバー", "ドライバ"],
  ["メーカー", "メーカ"],
  ["タイマー", "タイマ"],
  ["エレベーター", "エレベータ"],
  ["モーター", "モータ"],
  ["カレンダー", "カレンダ"],
  ["〜", "～"],
];

/** 全角と半角が混ざっているときだけ、少数派を多数派に寄せる。 */
const WIDTH_GROUPS: { name: string; checkId: string; half: RegExp; full: RegExp }[] = [
  { name: "数字", checkId: NOTATION_CHECKS.digits, half: /[0-9]+/g, full: /[０-９]+/g },
  { name: "英字", checkId: NOTATION_CHECKS.alphabet, half: /[A-Za-z]+/g, full: /[Ａ-Ｚａ-ｚ]+/g },
];

const toFullWidth = (text: string) =>
  text.replace(/[0-9A-Za-z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0xfee0),
  );

const toHalfWidth = (text: string) =>
  text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );

function scanVariantGroups(text: string): ProofreadHit[] {
  const hits: ProofreadHit[] = [];

  for (const group of VARIANT_GROUPS) {
    const ordered = [...group].sort((left, right) => right.length - left.length);
    const pattern = new RegExp(ordered.join("|"), "g");
    const found: { variant: string; index: number }[] = [];

    let match = pattern.exec(text);
    while (match) {
      // 「見積書」「手続法」のように、送り仮名を省いた形が別の熟語の一部に
      // なっていることがある。漢字で終わる表記の直後が漢字なら複合語とみなす。
      const variant = match[0];
      const next = text[match.index + variant.length];
      const isCompound =
        KANJI_CHARACTER.test(variant[variant.length - 1]) &&
        next !== undefined &&
        KANJI_CHARACTER.test(next);
      if (!isCompound) found.push({ variant, index: match.index });
      match = pattern.exec(text);
    }
    if (!found.length) continue;

    const counts = new Map<string, number>();
    for (const item of found) counts.set(item.variant, (counts.get(item.variant) ?? 0) + 1);
    if (counts.size < 2) continue;

    // 同数で並んだときは、グループの先頭に置いた推奨表記へ寄せる。
    let dominant = group[0];
    let dominantCount = -1;
    for (const variant of group) {
      const count = counts.get(variant) ?? 0;
      if (count > dominantCount) {
        dominant = variant;
        dominantCount = count;
      }
    }

    const mixed = [...counts.keys()].filter((variant) => variant !== dominant).join("」「");
    for (const item of found) {
      if (item.variant === dominant) continue;
      if (hits.length >= MAX_HITS_PER_RULE) break;
      hits.push({
        checkId: NOTATION_CHECKS.okurigana,
        from: item.index,
        to: item.index + item.variant.length,
        message: `表記がゆれています（「${dominant}」と「${mixed}」）。`,
        replacement: dominant,
        detail: `同じ原稿の中で「${dominant}」が${dominantCount}回使われています。`,
      });
    }
  }

  for (const group of WIDTH_GROUPS) {
    const halfMatches = [...text.matchAll(group.half)];
    const fullMatches = [...text.matchAll(group.full)];
    if (!halfMatches.length || !fullMatches.length) continue;

    const minority = halfMatches.length < fullMatches.length ? halfMatches : fullMatches;
    const toMajority = halfMatches.length < fullMatches.length ? toFullWidth : toHalfWidth;
    const majorityLabel = halfMatches.length < fullMatches.length ? "全角" : "半角";

    for (const item of minority) {
      if (hits.length >= MAX_HITS_PER_RULE) break;
      if (item.index === undefined) continue;
      hits.push({
        checkId: group.checkId,
        from: item.index,
        to: item.index + item[0].length,
        message: `${group.name}の全角と半角が混ざっています。原稿では${majorityLabel}が多数です。`,
        replacement: toMajority(item[0]),
      });
    }
  }

  return hits;
}

const notationRule: ProofreadRule = {
  id: "notation-variants",
  name: "表記のゆれ",
  summary:
    "同じ語の送り仮名・外来語の長音・全角半角が原稿の中で食い違っていないかを、出現数を数えて見る。",
  severity: "should",
  target: "common",
  respectsDialogue: false,
  wordScoped: true,
  checks: [
    {
      id: NOTATION_CHECKS.okurigana,
      name: "送り仮名・外来語のゆれ",
      summary: "同じ語の送り方や長音が原稿の中で食い違っていないか。",
    },
    {
      id: NOTATION_CHECKS.digits,
      name: "数字の全角・半角",
      summary: "縦組で数字を全角に揃えるなど、意図して使い分けるなら外します。",
    },
    {
      id: NOTATION_CHECKS.alphabet,
      name: "英字の全角・半角",
      summary: "縦組で英字を全角に揃えるなど、意図して使い分けるなら外します。",
    },
    {
      id: NOTATION_CHECKS.space,
      name: "全角と半角の間の空き",
      summary: "半角語の前後を空けて読みやすくする書き方もあります。外せます。",
    },
  ],
  sources: [OKURIGANA, GAIRAIGO, JTF_STYLE, KISHA_HANDBOOK],
  scan: (context: ProofreadContext) => [
    ...scanVariantGroups(context.scanText),
    ...collectMatches(context.scanText, [
      {
        // JTFスタイルガイド2.3.1.1。全角文字と半角文字の間にスペースを入れない。
        checkId: NOTATION_CHECKS.space,
        pattern: /(?<=[ぁ-んァ-ヴ一-龥ー、。])[ ]+(?=[0-9A-Za-z])|(?<=[0-9A-Za-z])[ ]+(?=[ぁ-んァ-ヴ一-龥ー、。])/g,
        message: "全角文字と半角文字の間にはスペースを入れません。",
        replace: () => "",
      },
    ]),
  ],
};

// ---------------------------------------------------------------------------
// 7. 語句の誤用
// ---------------------------------------------------------------------------

const wordMisuseRule: ProofreadRule = {
  id: "word-misuse",
  name: "語句の誤用",
  summary:
    "本来の意味と取り違えられやすい語と、言い方そのものが違う語を拾う。会話文も対象にする。",
  severity: "should",
  target: "common",
  respectsDialogue: false,
  wordScoped: true,
  sources: [KOKUGO_YORON, KOTOBA_SHOKUDO],
  scan: (context) =>
    collectMatches(context.scanText, [
      ...IDIOM_MEANINGS.map<Substitution>((entry) => ({
        pattern: new RegExp(entry.patterns.map(escapeRegExp).join("|"), "g"),
        message: `「${entry.word}」の本来の意味は「${entry.correct}」です。`,
        detail: `「${entry.confused}」の意味で使っていないか確かめます（${entry.survey}）。取り違えかどうかは文脈によります。`,
      })),
      ...IDIOM_FORMS.map<Substitution>((entry) => ({
        pattern: new RegExp(escapeRegExp(entry.wrong), "g"),
        message: `「${entry.meaning}」は「${entry.right}」が本来の言い方です。`,
        detail: `${entry.survey}で取り上げられた言い方。`,
        replace: () => entry.right,
      })),
      {
        pattern: new RegExp(MIMIZAWARI_PATTERNS.map(escapeRegExp).join("|"), "g"),
        message: "「耳ざわり」は「聞いていて耳に障ること」なので、良い意味の修飾とは結び付きません。",
        detail: "「耳当たりのよい」「聞き心地のよい」などに言い換えます。",
      },
    ]),
};

// ---------------------------------------------------------------------------
// 8. 敬語の誤り
// ---------------------------------------------------------------------------

/** 「おっしゃられる」を「おっしゃる」の適切な活用へ戻すための対応表。 */
const OSSHARU_FORMS: Record<string, string> = {
  れる: "おっしゃる",
  れた: "おっしゃった",
  れて: "おっしゃって",
  れます: "おっしゃいます",
  れました: "おっしゃいました",
  れません: "おっしゃいません",
};

/** 「（さ）せていただく」は数が増えたときだけ知らせる。1回1回は誤りではない。 */
const SASETE_ITADAKU_PATTERN = /さ?せていただ(く|き|け|こ|い)/g;
const SASETE_ITADAKU_LIMIT = 3;

function scanKeigo(context: ProofreadContext): ProofreadHit[] {
  const text = context.scanText;

  const hits = collectMatches(text, [
    {
      // 「お読みになられる」型。定着した二重敬語（お召し上がりになる等）はこの形を取らない。
      pattern: /([おご御])([ぁ-んァ-ヶー一-龥]{1,8}?)になら(れる|れた|れて|れます|れました|れません)/g,
      message: "二重敬語です。「お（ご）〜になる」だけで尊敬語になっています。",
      detail: "「敬語の指針」は、同じ種類の敬語を重ねた二重敬語は一般に適切ではないとしています。",
      replace: (match) => `${match[1]}${match[2]}にな${NARARERU_ENDINGS[match[3]] ?? ""}`,
    },
    {
      pattern: /おっしゃら(れる|れた|れて|れます|れました|れません)/g,
      message: "二重敬語です。「おっしゃる」だけで尊敬語になっています。",
      replace: (match) => OSSHARU_FORMS[match[1]],
    },
    {
      pattern: /(拝見|拝借|拝読)さ?れ(る|た|て|ます|ました)/g,
      message: "謙譲語に尊敬の「れる」が付いています。相手の動作なら「ご覧になる」などを使います。",
    },
    {
      // 「担当者にお聞きしてください」型。謙譲語Ⅰを相手の動作に使ってしまう誤り。
      pattern: /([おご御])([ぁ-んァ-ヶー一-龥]{1,8}?)してください/g,
      message: "謙譲語を相手の動作に使っています。「お（ご）〜ください」が尊敬語の形です。",
      detail: "「敬語の指針」【10】【11】が挙げている、尊敬語と謙譲語Ⅰの混同に当たります。",
      // 「彼にお願いしてください」のように第三者へ頼む場合は誤りではないので外す。
      accept: (match) => match[2] !== "願い",
      replace: (match) => `${match[1]}${match[2]}ください`,
    },
    {
      pattern: /伺ってください/g,
      message: "「伺う」は謙譲語です。相手の動作なら「お聞きください」「お尋ねください」を使います。",
      replace: () => "お聞きください",
    },
    {
      pattern: /(ご|御)苦労様/g,
      message: "「御苦労様」はねぎらいの言葉で、目上の人には使わない方がよいとされています。",
      detail: "「敬語の指針」【27】。目上には「お疲れ様でございました」「ありがとうございました」。",
    },
  ]).filter(
    (hit) =>
      !ESTABLISHED_DOUBLE_HONORIFICS.some((phrase) =>
        text.startsWith(phrase, hit.from),
      ),
  );

  const sasete = [...text.matchAll(SASETE_ITADAKU_PATTERN)];
  if (sasete.length >= SASETE_ITADAKU_LIMIT) {
    for (const match of sasete.slice(0, MAX_HITS_PER_RULE - hits.length)) {
      if (match.index === undefined) continue;
      hits.push({
        from: match.index,
        to: match.index + match[0].length,
        message: `「させていただく」が${sasete.length}か所あります。`,
        detail:
          "「敬語の指針」【18】は、相手の許可を受けて行い、そのことで恩恵を受ける場合に使う形だとしています。当てはまらない箇所は「いたします」で足ります。",
      });
    }
  }

  return hits;
}

const keigoRule: ProofreadRule = {
  id: "keigo",
  name: "敬語の誤り",
  summary:
    "二重敬語、謙譲語と尊敬語の取り違え、「させていただく」の多用を見る。会話文も対象にする。",
  severity: "should",
  target: "common",
  respectsDialogue: false,
  wordScoped: true,
  sources: [KEIGO_SHISHIN],
  scan: scanKeigo,
};

// ---------------------------------------------------------------------------
// 9. 文体の混在
// ---------------------------------------------------------------------------

const POLITE_ENDINGS =
  /(です|ます|ました|ません|ませんでした|でした|でしょう|ましょう|ください|ございます|ございました)$/;
const PLAIN_ENDINGS = /(である|であった|だった|だ|た|る|ない|う|い|か)$/;

/** 文末から敬体・常体を判定する。どちらとも取れない文は数えない。 */
function sentenceStyle(text: string): "polite" | "plain" | null {
  const body = text
    .replace(/\s+/g, "")
    .replace(/[。．！？…―）」』]+$/u, "");
  if (!body) return null;
  if (POLITE_ENDINGS.test(body)) return "polite";
  if (PLAIN_ENDINGS.test(body)) return "plain";
  return null;
}

/** 文体が固まったと言える最小の文数。短い断片で混在を騒がない。 */
const STYLE_SAMPLE_MIN = 5;

const styleConsistencyRule: ProofreadRule = {
  id: "style-consistency",
  name: "文体の混在",
  summary: "地の文が敬体（ですます調）と常体（である調）で混ざっていないかを見る。",
  severity: "should",
  target: "article",
  respectsDialogue: true,
  wordScoped: false,
  sources: [JTF_STYLE],
  scan: (context) => {
    const scored: { from: number; to: number; style: "polite" | "plain" }[] = [];
    for (const sentence of context.sentences) {
      if (isRangeMasked(context.narrationText, sentence.from, sentence.to)) continue;
      const style = sentenceStyle(sentence.text);
      if (style) scored.push({ from: sentence.from, to: sentence.to, style });
    }
    if (scored.length < STYLE_SAMPLE_MIN) return [];

    const polite = scored.filter((item) => item.style === "polite").length;
    const plain = scored.length - polite;
    if (!polite || !plain) return [];

    const minority = polite < plain ? "polite" : "plain";
    const majorityLabel = minority === "polite" ? "常体（である調）" : "敬体（ですます調）";

    return scored
      .filter((item) => item.style === minority)
      .slice(0, MAX_HITS_PER_RULE)
      .map((item) => ({
        from: item.from,
        to: item.to,
        message: `文体が混在しています（敬体${polite}文・常体${plain}文）。`,
        detail: `この文書では${majorityLabel}が多数です。JTFスタイルガイド1.1.1は、敬体と常体を混在させないとしています。`,
      }));
  },
};

// ---------------------------------------------------------------------------
// 10. 辞書の表記ゆれ
// ---------------------------------------------------------------------------

/**
 * 辞書で「揃える」に指定した語を本文と突き合わせる。
 *
 * ・別表記として登録した形が出てきたら、決めた表記へ寄せる。
 * ・ルビの読みが辞書と食い違っていたら知らせる。同じ読みに違う字が
 *   当たっている場合は、変換ミスの可能性が高いので表記を示す。
 *
 * 固定の辞書では拾えない、作品ごとの揺れを見るためのルール。登録した語しか
 * 見ないので、原稿から勝手に似た語を探しに行くことはしない。
 */
function scanDictionaryUnify(context: ProofreadContext): ProofreadHit[] {
  const unifyTerms = context.terms.filter(
    (term) => term.policy === "unify" || term.policy === "both",
  );
  if (!unifyTerms.length) return [];

  const hits: ProofreadHit[] = [];

  // 決めた表記そのものを先に潰しておく。「モーター」を伏せずに別表記の
  // 「モータ」を探すと、正しい方の一部にも当たってしまう。
  const variantText = maskSurfaces(
    context.scanText,
    unifyTerms.map((term) => term.surface),
  );

  for (const term of unifyTerms) {
    for (const variant of term.variants) {
      if (!variant || variant === term.surface) continue;
      let index = variantText.indexOf(variant);
      while (index >= 0 && hits.length < MAX_HITS_PER_RULE) {
        hits.push({
          from: index,
          to: index + variant.length,
          message: `辞書では「${term.surface}」に決めています。`,
          detail: `「${variant}」を別表記として登録しています。`,
          replacement: term.surface,
        });
        index = variantText.indexOf(variant, index + variant.length);
      }
    }
  }

  const withReading = unifyTerms.filter((term) => term.reading);
  const bySurface = new Map(withReading.map((term) => [term.surface, term]));
  const byReading = new Map(withReading.map((term) => [term.reading, term]));

  for (const ruby of collectRubyAnnotations(context.text)) {
    if (hits.length >= MAX_HITS_PER_RULE) break;

    const sameSurface = bySurface.get(ruby.base);
    if (sameSurface && sameSurface.reading !== ruby.reading) {
      hits.push({
        from: ruby.from,
        to: ruby.to,
        message: `「${ruby.base}」の読みは辞書では「${sameSurface.reading}」です。`,
        detail: `本文のルビは「${ruby.reading}」になっています。`,
      });
      continue;
    }

    const sameReading = byReading.get(ruby.reading);
    if (sameReading && sameReading.surface !== ruby.base) {
      hits.push({
        from: ruby.baseFrom,
        to: ruby.baseTo,
        message: `読み「${ruby.reading}」の表記は辞書では「${sameReading.surface}」です。`,
        detail: "同じ読みに違う字が当たっています。変換ミスの可能性があります。",
        replacement: sameReading.surface,
      });
    }
  }

  return hits;
}

const dictionaryUnifyRule: ProofreadRule = {
  id: "dictionary-unify",
  name: "辞書の表記ゆれ",
  summary:
    "辞書で「揃える」に指定した語について、別表記の混入とルビの読みの食い違いを見る。登録した語だけが対象。",
  severity: "should",
  target: "common",
  respectsDialogue: false,
  wordScoped: true,
  sources: [KOYOBUN, KISHA_HANDBOOK],
  scan: scanDictionaryUnify,
};

export const PROOFREAD_RULES: ProofreadRule[] = [
  colloquialRule,
  kanjiOpeningRule,
  sentenceRule,
  redundancyRule,
  punctuationRule,
  notationRule,
  wordMisuseRule,
  keigoRule,
  styleConsistencyRule,
  dictionaryUnifyRule,
  ijidokunRule,
  homophoneRule,
  topicPredicateRule,
];

export const proofreadRuleById = new Map(PROOFREAD_RULES.map((rule) => [rule.id, rule]));
