/**
 * 手掛かり語の補い。
 *
 * {@link IJIDOKUN_GROUPS} は報告の用例だけから作ってあるので、報告が例に挙げて
 * いない日常語（「質問に答える」「洗濯物が乾く」など）は拾えない。ここでは
 * 報告が示した語義の範囲を出ないように、同じ意味で使う語を足す。項目そのもの
 * を増やすわけではないので、根拠は引き続き報告の語義とする。
 *
 * 見出しは表記そのままで書き、番号への解決は {@link IJIDOKUN_ITEMS} で行う。
 * 同じ項目の中で既に別の表記に割り当てられている語は、決め手にならないので
 * 足さない（`scripts/test-proofread-rules.mjs` で検査する）。
 */

import { IJIDOKUN_GROUPS, type IjidokunCue, type IjidokunGroup, type IjidokunRole } from "./ijidokunData";

type ExtraCue = {
  /** 報告の項目番号。 */
  no: string;
  /** 手掛かり語との関係。 */
  role: IjidokunRole;
  /** 手掛かり語。 */
  word: string;
  /** その語が示す表記。項目に載っている見出しをそのまま書く。 */
  head: string;
};

/** 報告の語義に沿って足した手掛かり語。 */
export const IJIDOKUN_EXTRA_CUES: ExtraCue[] = [
  // 008 あつい：熱い＝温度が高い／暑い＝気温が高い
  ...["コーヒー", "スープ", "風呂", "鉄板", "おでん", "紅茶", "視線", "議論", "血"].map((word) => ({ no: "008", role: "が" as IjidokunRole, word, head: "熱い" })),
  ...["夏", "日中", "気候", "車内", "教室", "屋外", "都心"].map((word) => ({ no: "008", role: "が" as IjidokunRole, word, head: "暑い" })),
  // 007 あたたかい：温かい＝冷たくない／暖かい＝寒くない
  ...["ご飯", "みそ汁", "弁当", "牛乳", "言葉", "拍手"].map((word) => ({ no: "007", role: "が" as IjidokunRole, word, head: "温かい" })),
  ...["日", "春", "冬", "毛布", "陽気", "地方"].map((word) => ({ no: "007", role: "が" as IjidokunRole, word, head: "暖かい" })),
  // 050 かわく：乾く＝水分がなくなる／渇く＝喉に潤いがなくなる
  ...["洗濯物", "ペンキ", "塗料", "地面", "髪", "布巾", "絵の具"].map((word) => ({ no: "050", role: "が" as IjidokunRole, word, head: "乾く" })),
  ...["口", "唇"].map((word) => ({ no: "050", role: "が" as IjidokunRole, word, head: "渇く" })),
  // 057 こたえる：答える＝解答する／応える＝応じる、報いる
  ...["質問", "問い", "問いかけ", "電話", "取材", "アンケート"].map((word) => ({ no: "057", role: "に" as IjidokunRole, word, head: "答える" })),
  ...["信頼", "支持", "熱意", "要望", "好意", "厚意", "応援", "求め"].map((word) => ({ no: "057", role: "に" as IjidokunRole, word, head: "応える" })),
  // 094 なおす・なおる：直す＝正しい状態に戻す／治す＝病気やけがから回復する
  ...["文章", "位置", "配線", "靴", "屋根", "癖", "機嫌", "表記"].map((word) => ({ no: "094", role: "を" as IjidokunRole, word, head: "直す" })),
  ...["病気", "虫歯", "持病", "花粉症"].map((word) => ({ no: "094", role: "を" as IjidokunRole, word, head: "治す" })),
  ...["病気", "虫歯", "傷口"].map((word) => ({ no: "094", role: "が" as IjidokunRole, word, head: "治る" })),
  // 097 ならう：習う＝教わって身に付ける／倣う＝手本としてまねる
  ...["書道", "水泳", "茶道", "そろばん", "踊り"].map((word) => ({ no: "097", role: "を" as IjidokunRole, word, head: "習う" })),
  ...["手本", "先例", "先輩"].map((word) => ({ no: "097", role: "に" as IjidokunRole, word, head: "倣う" })),
  // 028 おかす：犯す＝法や倫理に反する／侵す＝侵害する／冒す＝あえて行う
  ...["違反", "殺人", "過失"].map((word) => ({ no: "028", role: "を" as IjidokunRole, word, head: "犯す" })),
  ...["領土", "領海", "主権", "プライバシー", "私生活"].map((word) => ({ no: "028", role: "を" as IjidokunRole, word, head: "侵す" })),
  ...["リスク", "荒波"].map((word) => ({ no: "028", role: "を" as IjidokunRole, word, head: "冒す" })),
  // 029 おくる：送る＝届ける／贈る＝金品などを人に与える
  ...["メール", "手紙", "小包", "書類", "データ"].map((word) => ({ no: "029", role: "を" as IjidokunRole, word, head: "送る" })),
  ...["花束", "記念品", "賞状", "贈り物", "勲章"].map((word) => ({ no: "029", role: "を" as IjidokunRole, word, head: "贈る" })),
  // 086 つとめる：勤める＝勤務する／務める＝役目を果たす／努める＝力を尽くす
  ...["会社", "役所", "大学", "病院", "商社"].map((word) => ({ no: "086", role: "に" as IjidokunRole, word, head: "勤める" })),
  ...["主役", "司会", "幹事", "座長", "主将", "委員長"].map((word) => ({ no: "086", role: "を" as IjidokunRole, word, head: "務める" })),
  ...["改善", "普及", "向上", "回復", "防止"].map((word) => ({ no: "086", role: "に" as IjidokunRole, word, head: "努める" })),
  // 033 おさまる・おさめる：収める＝中に入れる／納める＝渡す、しまう／治める＝統治する／修める＝学ぶ
  ...["勝利", "利益", "写真", "全集"].map((word) => ({ no: "033", role: "を" as IjidokunRole, word, head: "収める" })),
  ...["会費", "授業料", "保険料", "年貢"].map((word) => ({ no: "033", role: "を" as IjidokunRole, word, head: "納める" })),
  ...["学業", "課程", "徳"].map((word) => ({ no: "033", role: "を" as IjidokunRole, word, head: "修める" })),
  // 104 はかる：図る＝企てる／計る＝時間や数／測る＝長さや程度／量る＝重さや容積／謀る＝たくらむ／諮る＝意見を聞く
  ...["効率化", "実現", "改善", "調整"].map((word) => ({ no: "104", role: "を" as IjidokunRole, word, head: "図る" })),
  ...["脈", "秒数"].map((word) => ({ no: "104", role: "を" as IjidokunRole, word, head: "計る" })),
  ...["体温", "深さ", "高さ", "気温", "視力"].map((word) => ({ no: "104", role: "を" as IjidokunRole, word, head: "測る" })),
  ...["目方", "分量"].map((word) => ({ no: "104", role: "を" as IjidokunRole, word, head: "量る" })),
  ...["部会", "総会", "理事会"].map((word) => ({ no: "104", role: "に" as IjidokunRole, word, head: "諮る" })),
  // 092 とる：取る＝手にする／採る＝選び取る／執る＝行う／捕る＝捕まえる／撮る＝撮影する
  ...["動画", "映像", "スナップ"].map((word) => ({ no: "092", role: "を" as IjidokunRole, word, head: "撮る" })),
  ...["方針", "手段", "人材"].map((word) => ({ no: "092", role: "を" as IjidokunRole, word, head: "採る" })),
  ...["魚", "虫", "獲物"].map((word) => ({ no: "092", role: "を" as IjidokunRole, word, head: "捕る" })),
  // 110 ひく：引く＝手前に寄せる／弾く＝楽器を鳴らす
  ...["ギター", "オルガン", "ハープ"].map((word) => ({ no: "110", role: "を" as IjidokunRole, word, head: "弾く" })),
  // 099 のせる・のる：乗る＝乗り物や勢いに／載せる＝上に置く、掲載する
  ...["船", "飛行機", "自転車", "馬"].map((word) => ({ no: "099", role: "に" as IjidokunRole, word, head: "乗る" })),
  ...["記事", "情報", "写真", "地図"].map((word) => ({ no: "099", role: "を" as IjidokunRole, word, head: "載せる" })),
  // 078 たつ・たてる：立てる＝縦にする、成り立たせる／建てる＝建物を造る
  ...["学校", "工場", "寺", "小屋"].map((word) => ({ no: "078", role: "を" as IjidokunRole, word, head: "建てる" })),
  ...["予定", "仮説", "腹", "目標"].map((word) => ({ no: "078", role: "を" as IjidokunRole, word, head: "立てる" })),
  // 125 やぶれる：破れる＝裂ける、壊れる／敗れる＝負ける
  ...["紙", "服", "袋", "夢"].map((word) => ({ no: "125", role: "が" as IjidokunRole, word, head: "破れる" })),
  ...["試合", "決勝", "戦い"].map((word) => ({ no: "125", role: "に" as IjidokunRole, word, head: "敗れる" })),
  // 131 わく：沸く＝湯や場が熱く高まる／湧く＝地中や心から出てくる
  ...["お湯", "やかん", "会場"].map((word) => ({ no: "131", role: "が" as IjidokunRole, word, head: "沸く" })),
  ...["泉", "力", "元気", "感情", "実感"].map((word) => ({ no: "131", role: "が" as IjidokunRole, word, head: "湧く" })),
  // 091 とらえる：捕らえる＝つかまえる／捉える＝内容をつかむ
  ...["容疑者", "敵"].map((word) => ({ no: "091", role: "を" as IjidokunRole, word, head: "捕らえる" })),
  ...["本質", "特徴", "意味", "変化", "傾向"].map((word) => ({ no: "091", role: "を" as IjidokunRole, word, head: "捉える" })),
  // 075 たずねる：尋ねる＝問う／訪ねる＝訪問する
  ...["名前", "住所", "理由", "感想"].map((word) => ({ no: "075", role: "を" as IjidokunRole, word, head: "尋ねる" })),
  ...["実家", "恩師", "旧友"].map((word) => ({ no: "075", role: "を" as IjidokunRole, word, head: "訪ねる" })),
  // 121 みる：見る＝目でとらえる／診る＝診察する
  ...["映画", "テレビ", "夢"].map((word) => ({ no: "121", role: "を" as IjidokunRole, word, head: "見る" })),
  ...["容体", "症状"].map((word) => ({ no: "121", role: "を" as IjidokunRole, word, head: "診る" })),
  // 129 よむ：読む＝文字を追う／詠む＝詩歌を作る
  ...["本", "新聞", "記事", "資料"].map((word) => ({ no: "129", role: "を" as IjidokunRole, word, head: "読む" })),
  ...["短歌", "和歌", "一首"].map((word) => ({ no: "129", role: "を" as IjidokunRole, word, head: "詠む" })),
  // 044 かく：書く＝文字を記す／描く＝絵や図を表す
  ...["論文", "原稿", "メモ", "住所"].map((word) => ({ no: "044", role: "を" as IjidokunRole, word, head: "書く" })),
  ...["絵", "イラスト", "風景", "人物"].map((word) => ({ no: "044", role: "を" as IjidokunRole, word, head: "描く" })),
  // 059 さがす：探す＝欲しいものを／捜す＝見えなくなったものを
  ...["部屋", "アルバイト", "資料"].map((word) => ({ no: "059", role: "を" as IjidokunRole, word, head: "探す" })),
  ...["遺留品", "落とし物", "迷子"].map((word) => ({ no: "059", role: "を" as IjidokunRole, word, head: "捜す" })),
];

const resolve = (group: IjidokunGroup, head: string) => {
  for (const [variant, entry] of group.variants.entries()) {
    const index = entry.heads.indexOf(head);
    if (index >= 0) return [variant, index] as const;
  }
  return null;
};

/**
 * 報告の手掛かり語に補いを足したもの。ルールはこちらを使う。
 *
 * 見出しが見つからない行や、同じ項目で既に別の表記に割り当てられている語は
 * 落とす。データを作り直したときに黙って誤った候補を出さないための備え。
 */
export const IJIDOKUN_ITEMS: IjidokunGroup[] = IJIDOKUN_GROUPS.map((group) => {
  const extra = IJIDOKUN_EXTRA_CUES.filter((cue) => cue.no === group.no);
  if (!extra.length) return group;
  const claimed = new Map(group.cues.map((cue) => [cue[1], cue[2]]));
  const cues: IjidokunCue[] = [...group.cues];
  for (const item of extra) {
    const located = resolve(group, item.head);
    if (!located) continue;
    const owner = claimed.get(item.word);
    if (owner !== undefined && owner !== located[0]) continue;
    claimed.set(item.word, located[0]);
    cues.push([item.role, item.word, located[0], located[1]]);
  }
  return { ...group, cues };
});
