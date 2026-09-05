/**
 * 「趣味は……読む」のような、主語と述語の食い違いを確認する。
 *
 * 「趣味は」「目標は」のように、それ自体が事柄を指す主語を受けるときは、述語も
 * 「〜することだ」の形で結ぶのが読みやすい。文が動詞で終わっているときだけ、
 * 結びを確認する候補として示す。省略や語り口を誤りとは断定しない。
 *
 * 係り受け解析を使っていた頃と同じ範囲を、文の切り出しと語尾の形だけで見る。
 * 解析器を必要としないので、配布したアプリでもそのまま動く。
 */

import { KOYOBUN } from "./sources";
import type { ProofreadHit, ProofreadRule } from "./types";

/** それ自体が事柄を指す主語。報告の例に合わせて限定する。 */
const TOPICS = ["趣味", "楽しみ", "目標", "目的"];

/** 「〜することだ」のように、事柄で結んでいる形。これなら確認しない。 */
const NOMINALIZED = /(こと|事|もの|物|ため|為|の|点|方)(だ|です|である|でした|だった|でしょう|だろう|になる|にある)?$/;

/** 動詞で言い切っている語尾。形容詞（「多い」）は含めない。 */
const VERB_ENDING = /(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々][うくぐすつぬぶむる]|ます|ました|ません|ている|ていた|ていました)$/u;

/** 名詞述語の結び。「登山です」は動詞ではない。 */
const COPULA = /(だ|です|でした|である|であった|だった|だろう|でしょう|ではない|ません)$/;

/**
 * 目的語や到達点を伴う文だけを見る。「趣味は増えました」のように主語の状態を
 * 述べているだけの文は、「〜することだ」で結ぶ対象ではない。
 */
const HAS_OBJECT = /[をにへ]/;

/** 主語と述語の間に別の節が挟まると対応が読めないので、そのときは確認しない。 */
const CLAUSE_BREAK = /(が、|けれど|けど|ので|のに|から、|し、|ため、|とき|時に)/;

export const topicPredicateRule: ProofreadRule = {
  id: "topic-predicate",
  name: "主述の対応",
  summary:
    "「趣味は」「楽しみは」「目標は」「目的は」で始まる文が動詞で終わっているとき、" +
    "「〜することだ」のような結びが適切か確認します。省略や語り口を誤りとは断定しません。",
  severity: "hint",
  target: "common",
  respectsDialogue: true,
  // 指摘は文全体を指すので、この範囲を辞書に登録させない。
  wordScoped: false,
  sources: [KOYOBUN],
  scan(context) {
    const hits: ProofreadHit[] = [];
    for (const sentence of context.sentences) {
      // 潰した範囲（コード・ルビ・会話文）を含む文は見ない。
      const scanned = context.narrationText.slice(sentence.from, sentence.to);
      if (scanned !== sentence.text) continue;
      const topic = TOPICS.find((word) => scanned.includes(`${word}は`));
      if (!topic) continue;
      const from = sentence.from + scanned.indexOf(`${topic}は`);
      const body = scanned.replace(/[。．.！？!?\s]+$/u, "");
      const predicate = body.slice(from - sentence.from + topic.length + 1);
      if (!predicate || CLAUSE_BREAK.test(predicate) || !HAS_OBJECT.test(predicate)) continue;
      if (NOMINALIZED.test(body) || COPULA.test(body) || !VERB_ENDING.test(body)) continue;
      hits.push({
        from,
        to: sentence.to,
        message: `「${topic}は」と文末の対応を確認してください。`,
        detail:
          "「〜することだ」のような結びが適切か確認します。主語と述語の形だけを見た候補で、" +
          "省略・語り口を誤りとは断定しません。出典：公用文作成の考え方「文の書き方」。",
      });
      if (hits.length >= 100) return hits;
    }
    return hits;
  },
};
