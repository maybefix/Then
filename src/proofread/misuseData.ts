/**
 * 語句の誤用と敬語の誤りのデータ。
 *
 * 意味・言い方は文化庁「国語に関する世論調査」および同庁の解説動画
 * 「ことば食堂へようこそ！」で取り上げられたものだけを載せている。
 * 出典で確認できない語は、辞書の記憶に頼って足さないこと。
 */

/** 本来の意味と取り違えられやすい語。置き換えでは直せないので確認を促す。 */
export type IdiomMeaningEntry = {
  /** 本文で探す語形。活用でぶれる部分は落として前方一致で持つ。 */
  patterns: string[];
  word: string;
  /** 辞書等で本来の意味とされてきたもの。 */
  correct: string;
  /** 本来とは異なる意味として広まっているもの。 */
  confused: string;
  /** 取り上げられた調査。 */
  survey: string;
};

export const IDIOM_MEANINGS: IdiomMeaningEntry[] = [
  {
    patterns: ["役不足"],
    word: "役不足",
    correct: "本人の力量に対して役目が軽すぎること",
    confused: "本人の力量に対して役目が重すぎること",
    survey: "平成18・24年度調査",
  },
  {
    patterns: ["気が置けない", "気の置けない"],
    word: "気が置けない",
    correct: "相手に気配りや遠慮をしなくてよいこと",
    confused: "相手に気配りや遠慮をしなくてはならないこと",
    survey: "平成18・24年度調査",
  },
  {
    patterns: ["敷居が高", "敷居は高"],
    word: "敷居が高い",
    correct: "相手に不義理などをしてしまい、行きにくい",
    confused: "高級すぎたり上品過ぎたりして、入りにくい",
    survey: "令和元年度調査",
  },
  {
    patterns: ["手をこまね", "手をこまぬ"],
    word: "手をこまねく",
    correct: "何もせずに傍観している",
    confused: "準備して待ち構える",
    survey: "令和元年度調査",
  },
  {
    patterns: ["浮足立", "浮き足立"],
    word: "浮足立つ",
    correct: "恐れや不安を感じ、落ち着かずそわそわしている",
    confused: "喜びや期待を感じ、落ち着かずそわそわしている",
    survey: "令和元年度調査",
  },
  {
    patterns: ["がぜん", "俄然"],
    word: "がぜん",
    correct: "急に、突然",
    confused: "とても、断然",
    survey: "令和2年度調査",
  },
  {
    patterns: ["破天荒"],
    word: "破天荒",
    correct: "だれも成し得なかったことをすること",
    confused: "豪快で大胆な様子",
    survey: "令和2年度調査",
  },
  {
    patterns: ["すべからく", "須らく"],
    word: "すべからく",
    correct: "当然、是非とも",
    confused: "すべて、皆",
    survey: "令和2年度調査",
  },
  {
    patterns: ["憮然"],
    word: "憮然",
    correct: "失望してぼんやりとしている様子",
    confused: "腹を立てている様子",
    survey: "平成30年度調査",
  },
  {
    patterns: ["御の字", "おんの字"],
    word: "御の字",
    correct: "大いに有り難い",
    confused: "一応、納得できる",
    survey: "平成30年度調査",
  },
  {
    patterns: ["砂をかむ", "砂を噛む"],
    word: "砂をかむよう",
    correct: "無味乾燥でつまらない様子",
    confused: "悔しくてたまらない様子",
    survey: "平成30年度調査",
  },
  {
    patterns: ["奇特"],
    word: "奇特",
    correct: "優れてほかと違って感心なこと",
    confused: "奇妙で珍しいこと",
    survey: "平成14年度調査",
  },
  {
    patterns: ["雨模様"],
    word: "雨模様",
    correct: "雨が降りそうな様子（まだ降っていない）",
    confused: "小雨が降ったりやんだりしている様子",
    survey: "ことば食堂",
  },
  {
    patterns: ["割愛"],
    word: "割愛する",
    correct: "惜しいと思うものを手放す",
    confused: "不必要なものを切り捨てる",
    survey: "ことば食堂",
  },
  {
    patterns: ["流れに棹", "流れに竿"],
    word: "流れに棹さす",
    correct: "傾向に乗って、ある事柄の勢いを増す行為をすること",
    confused: "傾向に逆らって、ある事柄の勢いを失わせる行為をすること",
    survey: "ことば食堂",
  },
  {
    patterns: ["世間ずれ", "世間擦れ"],
    word: "世間ずれ",
    correct: "世間を渡ってきてずる賢くなっている",
    confused: "世の中の考えから外れている",
    survey: "平成16年度調査",
  },
  {
    patterns: ["煮詰ま"],
    word: "煮詰まる",
    correct: "結論の出る状態になる",
    confused: "議論が行き詰まって結論が出せない状態になる",
    survey: "ことば食堂",
  },
  {
    patterns: ["他山の石"],
    word: "他山の石",
    correct: "他人の誤った言行も自分の行いの参考となる",
    confused: "他人の良い言行は自分の行いの手本となる",
    survey: "ことば食堂",
  },
  {
    patterns: ["琴線に触れ", "琴線にふれ"],
    word: "琴線に触れる",
    correct: "感動や共鳴を与えること",
    confused: "怒りを買ってしまうこと",
    survey: "ことば食堂",
  },
  {
    patterns: ["失笑"],
    word: "失笑する",
    correct: "こらえ切れず吹き出して笑う",
    confused: "笑いも出ないくらいあきれる",
    survey: "ことば食堂",
  },
  {
    patterns: ["情けは人のため"],
    word: "情けは人のためならず",
    correct: "人に情けを掛けておくと、巡り巡って結局は自分のためになる",
    confused: "人に情けを掛けて助けてやることは、結局はその人のためにならない",
    survey: "ことば食堂",
  },
];

/** 「耳ざわり」は「耳に障る」意味なので、良い意味の修飾とは結び付かない。 */
export const MIMIZAWARI_PATTERNS = ["耳ざわりのよ", "耳ざわりの良", "耳障りのよ", "耳障りの良"];

/** 言い方そのものが違う語。置き換え先が一つに決まる。 */
export type IdiomFormEntry = {
  wrong: string;
  right: string;
  meaning: string;
  survey: string;
};

export const IDIOM_FORMS: IdiomFormEntry[] = [
  {
    wrong: "新規まき返し",
    right: "新規まき直し",
    meaning: "今までのことを改め、最初から始めること",
    survey: "令和元年度調査",
  },
  {
    wrong: "雪辱を晴らす",
    right: "雪辱を果たす",
    meaning: "前に負けた相手に勝つこと",
    survey: "令和元年度調査",
  },
  {
    wrong: "噛んで含むよう",
    right: "噛んで含めるよう",
    meaning: "よく分かるように丁寧に説明すること",
    survey: "令和元年度調査",
  },
  {
    wrong: "かんで含むよう",
    right: "かんで含めるよう",
    meaning: "よく分かるように丁寧に説明すること",
    survey: "令和元年度調査",
  },
  {
    wrong: "明るみになる",
    right: "明るみに出る",
    meaning: "知られていなかったことが、世間に知られること",
    survey: "令和2年度調査",
  },
  {
    wrong: "寸暇を惜しまず",
    right: "寸暇を惜しんで",
    meaning: "僅かの時間も無駄にしない様子",
    survey: "令和2年度調査",
  },
  {
    wrong: "一つ返事",
    right: "二つ返事",
    meaning: "すぐに気持ちよく承諾すること",
    survey: "令和2年度調査",
  },
  {
    wrong: "天地天命に誓って",
    right: "天地神明に誓って",
    meaning: "自分の言うことにうそ偽りがないことを固く約束するさま",
    survey: "平成30年度調査",
  },
  {
    wrong: "舌の先の乾かぬうち",
    right: "舌の根の乾かぬうち",
    meaning: "前言に反したことを、すぐに言ったり行ったりするさま",
    survey: "平成30年度調査",
  },
  {
    wrong: "論戦を張る",
    right: "論陣を張る",
    meaning: "議論を組み立てて主張すること",
    survey: "平成30年度調査",
  },
];

/**
 * 「敬語の指針」が習慣として定着しているとする二重敬語。ここに載る形は
 * 指摘しない。
 */
export const ESTABLISHED_DOUBLE_HONORIFICS = [
  "お召し上がりになる",
  "お見えになる",
  "お伺いする",
  "お伺いいたす",
  "お伺い申し上げる",
];

/** 「お(ご)……になられる」を「お(ご)……になる」へ直すときの語尾。 */
export const NARARERU_ENDINGS: Record<string, string> = {
  れる: "る",
  れた: "った",
  れて: "って",
  れます: "ります",
  れました: "りました",
  れません: "りません",
};
