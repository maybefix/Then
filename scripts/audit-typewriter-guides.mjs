// Quantitative CSS + raster audit; production theme CSS, actual editor nesting.
// npm run audit:typewriter-guides  (writes evidence; does not change themes)
// --check exits nonzero when the documented provisional guardrail is exceeded.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { contrast, openThemePage } from "./lib/theme-contrast.mjs";
import { readAppCss } from "./lib/read-app-css.mjs";

const bundle = await build({ entryPoints: ["src/themes.ts"], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "error" });
const { themeCatalog } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const sourceHash=async()=>createHash('sha256').update(await readAppCss()).update(await readAppCss('src/styles/themes/index.css')).update(bundle.outputFiles[0].text).digest('hex');
const cssAndCatalogSha256=await sourceHash();
assert.equal(new Set(themeCatalog.map(t => t.id)).size, themeCatalog.length);
const output = path.resolve("docs/theme-guide-audit");
await mkdir(path.join(output, "screenshots"), { recursive: true });
const keep = new Set(["sen-light", "sen-dark", "newsroom-light", "newsroom-dark", "aplil-dark", "blossom-dark"]);
const clip = { x: 0, y: 0, width: 640, height: 480, scale: 1 };
const mix = (g, b, a) => ({ r: g.r*a+b.r*(1-a), g: g.g*a+b.g*(1-a), b: g.b*a+b.b*(1-a) });
const distance = (a, b) => Math.max(...["r", "g", "b"].map(k => Math.abs(a[k]-b[k])));
const separation = (a, b) => Math.hypot(...["r", "g", "b"].map(k => a[k]-b[k]));
const inferAlpha = (before, after, guide) => {
  const delta = ["r", "g", "b"].map(k => guide[k]-before[k]);
  const norm = delta.reduce((n, x) => n+x*x, 0);
  if (norm < 100) return null; // matching ink/guide colors cannot identify alpha
  return Math.max(0, Math.min(1, delta.reduce((n,x,i) => n+x*(after[["r","g","b"][i]]-before[["r","g","b"][i]]),0)/norm));
};
// Independently known compositing endpoints protect the measurement itself.
const black = {r:0,g:0,b:0}, white = {r:255,g:255,b:255};
assert.equal(inferAlpha(white, white, black), 0);
assert.equal(inferAlpha(white, black, black), 1);
assert.ok(Math.abs(inferAlpha(white, mix(black, white, .14), black)-.14) < 1e-12);
assert.equal(inferAlpha(black, black, black), null);
assert.ok(Math.abs(separation(black,mix(black,white,.24))/separation(black,white)-.76)<1e-12,
  "A guide matching the ink still reduces stroke/background separation");

const style = `position:absolute;left:0;top:0;width:640px;height:480px;min-width:0;min-height:0;padding:0;margin:0;display:block;`;
const fill = `position:absolute;inset:0;width:100%;height:100%;min-width:0;min-height:0;padding:0;margin:0;display:block;`;
const body = `<section class="appFrame" style="${style}" data-app-mode="write">
 <div class="workspace" data-app-mode="write" style="${fill}">
  <div class="editorColumn" style="${fill}border-radius:0;">
   <div class="verticalTypewriterShell" data-editor-display="continuous" style="${fill}--typewriter-guide-position:50%;overflow:hidden;">
    <div class="verticalTypewriterScroller" style="${fill}overflow:hidden;">
     <div class="verticalTypewriterPageSurface" style="${fill}">
      <div class="verticalTypewriterEditor" style="${fill}">
       <div class="ProseMirror pm-root" style="${fill}max-width:none;max-height:none;font-size:32px;line-height:1.8;">
        <p id="auditText" style="position:absolute;margin:0;padding:0;font-size:32px;line-height:1.8;">田中の手紙を読む。<br>中央線と文字の重なり</p>
        <span id="auditInk" aria-hidden="true" style="position:absolute;background:currentColor;"></span>
       </div>
      </div>
     </div>
    </div>
    <div class="verticalTypewriterGuide"></div>
   </div>
  </div>
 </div>
</section>`;

const page = await openThemePage("guide-audit");
const rows = [];
try {
  await page.evaluate(`window.__samplePng = async (base64, points) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
    return points.map(p=>{const d=ctx.getImageData(p.x,p.y,1,1).data;return {r:d[0],g:d[1],b:d[2]}});
  }; true`);
  for (const definition of themeCatalog) {
    for (const writing of ["vertical-rl", "horizontal-tb"]) {
      await page.setScene(body, "editor", definition.id);
      const scene = await page.evaluate(`(async () => {
        const shell=document.querySelector('.appShell');shell.dataset.writingMode=${JSON.stringify(writing)};
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const guide=document.querySelector('.verticalTypewriterGuide'), ink=document.querySelector('#auditInk');
        const horizontal=${writing === "horizontal-tb"};
        const box=guide.getBoundingClientRect(), style=getComputedStyle(guide), root=document.querySelector('.pm-root').getBoundingClientRect();
        const width=parseFloat(horizontal?style.borderTopWidth:style.borderLeftWidth);
        const axis=Math.floor(horizontal?box.top:box.left);
        Object.assign(ink.style,horizontal?{left:'272px',top:(axis-root.top-24)+'px',width:'96px',height:'48px'}
          :{left:(axis-root.left-24)+'px',top:'192px',width:'48px',height:'96px'});
        const text=document.querySelector('#auditText');
        Object.assign(text.style,horizontal?{left:'48px',top:(axis-root.top-22)+'px',width:'200px',height:'160px'}
          :{left:(axis-root.left-20)+'px',top:'32px',width:'120px',height:'140px'});
        const inkBox=ink.getBoundingClientRect(), points=[], backgroundPoints=[];
        for(let across=0;across<Math.max(1,Math.ceil(width));across++){
          for(let along=4;along<92;along++) points.push(horizontal?{x:Math.round(inkBox.left+along),y:axis+across}:{x:axis+across,y:Math.round(inkBox.top+along)});
          for(let along=8;along<40;along++) backgroundPoints.push(horizontal?{x:Math.round(inkBox.right+along),y:axis+across}:{x:axis+across,y:Math.round(inkBox.bottom+along)});
        }
        let opacity=1;for(let el=guide;el;el=el.parentElement)opacity*=Number(getComputedStyle(el).opacity);
        return {points,backgroundPoints,guideColor:parse(horizontal?style.borderTopColor:style.borderLeftColor),
          rawGuideColor:horizontal?style.borderTopColor:style.borderLeftColor,configuredAlpha:parse(horizontal?style.borderTopColor:style.borderLeftColor).a*opacity,
          guideZIndex:style.zIndex,scrollerZIndex:getComputedStyle(document.querySelector('.verticalTypewriterScroller')).zIndex,
          pointerEvents:style.pointerEvents,borderStyle:horizontal?style.borderTopStyle:style.borderLeftStyle,width,
          editorScheme:getComputedStyle(document.querySelector('.editorColumn')).colorScheme,
          blendMode:style.mixBlendMode,filter:style.filter,shown:style.display!=='none'&&style.visibility==='visible'};
      })()`);
      assert.equal(scene.blendMode, "normal", "Nonstandard blending needs a separate model");
      assert.equal(scene.filter, "none", "Filters need a separate model");
      assert.ok(scene.points.length > 0 && scene.points.every(p=>p.x>=0&&p.x<640&&p.y>=0&&p.y<480), `${definition.id}: probe must be inside the capture`);
      await page.evaluate(`document.querySelector('.verticalTypewriterGuide').style.visibility='hidden'; true`);
      const off = await page.capture(clip);
      await page.evaluate(`document.querySelector('#auditInk').style.visibility='hidden'; true`);
      const bare = await page.capture(clip);
      await page.evaluate(`document.querySelector('#auditInk').style.visibility='';document.querySelector('.verticalTypewriterGuide').style.visibility='';true`);
      const on = await page.capture(clip);
      const samples = await page.evaluate(`(async()=>({
        off:await __samplePng(${JSON.stringify(off)},${JSON.stringify([...scene.points,...scene.backgroundPoints])}),
        bare:await __samplePng(${JSON.stringify(bare)},${JSON.stringify(scene.points)}),
        on:await __samplePng(${JSON.stringify(on)},${JSON.stringify([...scene.points,...scene.backgroundPoints])})}))()`);
      const count = scene.points.length;
      const inkAlphas = samples.off.slice(0,count).map((c,i)=>inferAlpha(c,samples.on[i],scene.guideColor)).filter(x=>x!==null);
      const bgAlphas = samples.off.slice(count).map((c,i)=>inferAlpha(c,samples.on[count+i],scene.guideColor)).filter(x=>x!==null);
      const maxInkAlpha = inkAlphas.length ? Math.max(...inkAlphas) : null;
      const maxBgAlpha = bgAlphas.length ? Math.max(...bgAlphas) : 0;
      const inkDelta = Math.max(...samples.off.slice(0,count).map((c,i)=>distance(c,samples.on[i])));
      const guideVisible = Math.max(inkDelta,...samples.off.slice(count).map((c,i)=>distance(c,samples.on[count+i]))) > 1;
      const baselineContrasts = samples.off.slice(0,count).map((c,i)=>contrast(c,samples.bare[i]));
      // Local background under the painted guide is modeled at the exact same
      // pixel as the stroke; PNG measurements supply the effective coverage.
      const underBackgrounds = samples.on.slice(0,count).map((c,i)=> {
        const a=inferAlpha(samples.off[i],c,scene.guideColor);
        const coverage=a!==null&&a>.002?a:maxBgAlpha;
        return mix(scene.guideColor,samples.bare[i],coverage);
      });
      const underContrasts=samples.on.slice(0,count).map((c,i)=>contrast(c,underBackgrounds[i]));
      const baselineContrast = Math.min(...baselineContrasts), crossingContrast=Math.min(...underContrasts);
      assert.ok(baselineContrast>1.1, `${definition.id}: the solid stroke probe must be distinguishable from its backdrop`);
      const retentions=samples.on.slice(0,count).map((c,i)=>
        separation(c,underBackgrounds[i])/separation(samples.off[i],samples.bare[i]));
      const retention=Math.min(...retentions);
      const evidenceAt=i=>({point:scene.points[i],offStroke:samples.off[i],offBackground:samples.bare[i],onStroke:samples.on[i],onBackground:underBackgrounds[i]});
      const flags=[];
      if(retention<.795) flags.push(retention<.05?"stroke-background-merge":"separation-loss-over-20pct");
      if(baselineContrast>=4.5 && crossingContrast<4.5) flags.push("local-contrast-below-4.5");
      if(scene.pointerEvents!=="none") flags.push("intercepts-input");
      const row={theme:definition.id,label:definition.label,mode:definition.mode,writing,editorScheme:scene.editorScheme,
        configuredColor:scene.rawGuideColor,configuredAlpha:scene.configuredAlpha,measuredInkAlpha:maxInkAlpha,measuredBackgroundAlpha:maxBgAlpha,
        strokeRetention:retention,maxInkChannelChange:inkDelta,baselineContrast,crossingContrast,
        guideVisible,guideZIndex:scene.guideZIndex,scrollerZIndex:scene.scrollerZIndex,
        borderWidth:scene.width,borderStyle:scene.borderStyle,status:flags.length?"review":guideVisible?"within-guardrail":"not-visible",flags,
        rasterEvidence:{lowestSeparation:evidenceAt(retentions.indexOf(retention)),lowestContrast:evidenceAt(underContrasts.indexOf(crossingContrast))}};
      rows.push(row);
      if(keep.has(definition.id)||flags.length) {
        const name=`${definition.id}-${writing==='vertical-rl'?'vertical':'horizontal'}`;
        await writeFile(path.join(output,"screenshots",`${name}-off.png`),Buffer.from(off,"base64"));
        await writeFile(path.join(output,"screenshots",`${name}-on.png`),Buffer.from(on,"base64"));
      }
    }
    console.log(`${rows.length}/${themeCatalog.length*2}: ${definition.id}`);
  }
} finally { await page.close(); }

assert.equal(rows.length,themeCatalog.length*2);
assert.equal(new Set(rows.map(r=>`${r.theme}/${r.writing}`)).size,rows.length);
assert.equal(await sourceHash(),cssAndCatalogSha256,"Theme CSS must stay unchanged during the audit");
const round = value => value===null?null:+value.toFixed(4);
const report={generatedAt:new Date().toISOString(),cssAndCatalogSha256,themeCount:themeCatalog.length,sceneCount:rows.length,
  guardrails:{minimumStrokeRetention:0.8,rasterRoundingAllowance:0.005,localContrastReference:4.5},
  methodology:"Production CSS and editor ancestor structure. Fixed geometry deliberately crosses a solid currentColor stroke probe. Three PNG captures: guide off, guide off with probe hidden, guide on. Estimate alpha by RGB projection; null when guide and ink colors match. Stroke retention is the minimum Euclidean sRGB stroke/background separation under the guide divided by the guide-off separation, not 1 minus ink-alpha. This detects a guide matching the ink. Background under the stroke is modeled at its exact pixel using effective measured guide coverage. Compute local luminance ratio with the same colors. The 80% retention guardrail is a provisional engineering policy, not a WCAG rule. 4.5 is only a local reference, not whole-text compliance. Fixed 640x480, 1x UI/DPR, normal body ink; not a Japanese-reading study or all decoration/font/layout states.",
  rows:rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='number'?round(v):v])))};
await writeFile(path.join(output,"results.json"),JSON.stringify(report,null,2));
const columns=Object.keys(report.rows[0]);
const csvCell=v=>`"${String(Array.isArray(v)?v.join(';'):v&&typeof v==='object'?JSON.stringify(v):v??'').replaceAll('"','""')}"`;
await writeFile(path.join(output,"results.csv"),'\ufeff'+[columns.join(','),...report.rows.map(r=>columns.map(k=>csvCell(r[k])).join(','))].join('\r\n'));
const review=rows.filter(r=>r.status==='review'), affected=new Set(review.map(r=>r.theme));
const percent=v=>v===null?'色一致のため推定不可':(v*100).toFixed(1)+'%';
const lines=["# タイプライター中央線：全テーマ定量評価","",
 `対象: ${themeCatalog.length}テーマ × 縦書き・横書き = ${rows.length}条件。要確認: ${affected.size}テーマ / ${review.length}条件。不可視: ${rows.filter(r=>!r.guideVisible).length}条件。`,"",
 "## 指標と判定","",
 "- 設定α: CSSの線色と祖先のopacityから計算。実測α: 線ON/OFFのPNGピクセルをRGB投影して算出。設定と描画順を区別する。",
 "- 色差保持率: 線ON時の筆画と背景のsRGB色差（ユークリッド距離）÷ 線OFF時の色差。80%以上を暫定の開発上の基準とする。80%はWCAGの基準ではない。RGB丸め誤差として0.5ポイントを許容。線と筆画が同色なら筆画上のαは推定できないが、背景の変化から色差保持率は計算できる。",
 "- 交差部の局所コントラスト比: PNGの筆画色と、同一座標の背景に線を合成した色から算出。通常文字の4.5:1を参考値にするが、細い交差部の評価だけでテキスト全体のWCAG適否は判定しない。",
 "- 設定αが高くても、線が本文の背面にあれば筆画の変化が0になる。その場合も線の背景への影響は別に記録する。", "",
 "## 要確認の条件","","| テーマ | 方向 | 設定α | 筆画上の実測α | 色差保持率 | 通常→交差部の比 | 指摘 |","|---|---|---:|---:|---:|---:|---|"];
for(const r of review)lines.push(`| ${r.label} (${r.theme}) | ${r.writing==='vertical-rl'?'縦':'横'} | ${percent(r.configuredAlpha)} | ${percent(r.measuredInkAlpha)} | ${percent(r.strokeRetention)} | ${r.baselineContrast.toFixed(2)} → ${r.crossingContrast.toFixed(2)} | ${r.flags.join(', ')} |`);
lines.push("","## 全条件","",`[全${rows.length}条件のCSV](results.csv) / [生データと測定方法](results.json)`,"",
 "JSONのrasterEvidenceには、色差・コントラストが最も小さくなった座標と、線OFF/ONの筆画色・背景色を保存する。指摘条件と代表例のPNGはscreenshots/に保存する。","",
 "## 再実行","","`npm run audit:typewriter-guides` はレポートを更新する。`npm run audit:typewriter-guides -- --check` は暫定基準を超える条件があると終了コード1を返す。テーマのCSSは変更しない。","",
 "固定したテスト寸法・1倍倍率で通常の本文色と中央線を交差させた測定。全フォント・全装飾・全組版・全倍率の読みやすさを保証するものではない。測定コードの塗りつぶし筆画プローブはフォントのアンチエイリアスを除いて描画順と合成色を検証するためのもの。","",
 "参考: [W3C: Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。通常文字の4.5:1と、アンチエイリアスに依存しない色の評価について。","",
 "測定はこの作業時点のワークスペース（未コミットのAplil/Blossomと中央線修正を含む）を対象とする。");
await writeFile(path.join(output,"README.md"),lines.join('\n')+'\n');
console.log(`AUDIT: ${themeCatalog.length} themes / ${rows.length} scenes; review ${affected.size} themes / ${review.length} scenes. Reports: ${output}`);
if(process.argv.includes('--check')&&review.length)process.exitCode=1;
