// Fast, repeatable computed-style contracts. Full application screenshots are
// collected separately by audit-shuboku.mjs; this isolates CSS state changes.
import { mkdir, writeFile } from "node:fs/promises";
import { openThemePage, contrast } from "./lib/theme-contrast.mjs";
const directory='docs/shuboku-audit';await mkdir(directory,{recursive:true});
const page=await openThemePage('shuboku-contracts'),rows=[];
const shell=`<section class="appFrame" style="position:absolute;inset:0;padding-top:40px"><div class="workspace" data-app-mode="write" style="height:650px">
 <div class="leftWorkspaceCluster"><aside class="workspaceSidebar"><div class="sidebarScroll">
 <div class="treeItem fileTreeItem" id="row"><button class="treeItemPrimary fileTreeItemPrimary"><span class="treeItemName treeItemName-todo">未着手の原稿</span><span class="treeItemCharCount">1234</span></button></div>
 <span class="auditMuted" style="color:var(--text-muted)">補助テキスト</span><span class="auditFaint" style="color:var(--text-faint)">薄い補助テキスト</span>
 </div></aside></div>
 <div class="editorColumn"><div class="verticalTypewriterShell"><div class="verticalTypewriterScroller"><div class="verticalTypewriterEditor"><div class="pm-root">本文の確認</div></div></div></div></div>
 <aside class="rightSidebar"><div class="plotRightSidebarBody"><div class="plotPane"><div class="plotCard expandedPlotCard"><button class="plotCardNum">001</button><div class="plotCardContent"><textarea class="plotCardTitle">題名</textarea><textarea class="plotCardBody">本文</textarea></div></div></div></div></aside>
 </div></section>`;
const picker=`<section class="appFrame"></section><div class="modalBackdrop"><section class="modal themePickerModal"><div class="themePickerBody"><div class="themeOptions">
 <label class="themeOption"><input name="theme" type="radio" checked><span class="themePreview"><i></i><b></b></span><span class="themeOptionCopy"><strong>Shuboku</strong><small>選択済み</small></span></label>
 <label class="themeOption"><input name="theme" type="radio"><span class="themePreview"></span><span class="themeOptionCopy"><strong>比較するテーマ</strong></span></label>
 </div></div></section></div>`;
const palette=`<section class="appFrame"></section><div class="modalBackdrop commandPaletteBackdrop"><div class="commandPalette"><input class="commandPaletteInput" placeholder="検索"><ul class="commandPaletteList" role="listbox">
 <li class="commandPaletteItem active" role="option" aria-selected="true"><span class="commandPaletteLabel">最初のコマンド</span></li>
 <li class="commandPaletteItem" role="option"><span class="commandPaletteLabel">次のコマンド</span></li>
 </ul></div></div>`;
try{
 for(const theme of ['sen-light','sen-dark','standard','dark']){
  await page.setScene(shell,'editor',theme);
  const frame=await page.evaluate(`(()=>{
   const props=e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,image:s.backgroundImage,radius:s.borderRadius,shadow:s.boxShadow,border:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],outline:s.outline,color:s.color}};
   const name=document.querySelector('#row .treeItemName'),row=document.querySelector('#row'),before=name.getBoundingClientRect().x;
   row.classList.add('activeTreeItem');const after=name.getBoundingClientRect().x;row.classList.remove('activeTreeItem');
   const title=document.querySelector('.plotCardTitle'),normal=props(title);title.focus();const focus=props(title);
   return {treeShift:after-before,editor:props(document.querySelector('.editorColumn')),editorSurface:props(document.querySelector('.verticalTypewriterShell')),
    sidebar:props(document.querySelector('.rightSidebar')),plot:[...document.querySelectorAll('.plotPane,.plotCard,.plotCardNum,.plotCardTitle,.plotCardBody')].map(e=>({classes:e.className,...props(e)})),plotFocus:{normal,focus,focusVisible:title.matches(':focus-visible')}};
  })()`);
  const text={};for(const [key,selector] of Object.entries({fileName:'.treeItemName',fileCount:'.treeItemCharCount',muted:'.auditMuted',faint:'.auditFaint'})){
   const value=await page.read(selector);text[key]={color:value.rawColor,surface:value.surface,contrast:contrast(value.color,value.surface)};
  }
  await page.setScene(picker,'editor',theme);
  await page.pressKey('Tab','Tab',9);
  const options=await page.evaluate(`(()=>{const label=document.querySelector('.themeOption'),input=label.querySelector('input');const read=()=>{const s=getComputedStyle(label);return {background:s.backgroundColor,border:s.border,borderColor:s.borderColor,shadow:s.boxShadow,outline:s.outline}};const checked=read();input.checked=false;const unchecked=read();input.checked=true;input.focus();return {checked,unchecked,focused:read(),inputOpacity:getComputedStyle(input).opacity,focusVisible:input.matches(':focus-visible'),distinct:JSON.stringify(checked)!==JSON.stringify(unchecked)}})()`);
  await page.setScene(palette,'editor',theme);
  const commands=await page.evaluate(`(()=>{const p=document.querySelector('.commandPalette'),item=document.querySelector('.commandPaletteItem.active');const read=e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,border:s.border,outline:s.outline,shadow:s.boxShadow,radius:s.borderRadius}};const active=read(item);item.classList.remove('active');const inactive=read(item);item.classList.add('active');return {panel:read(p),active,inactive,distinct:JSON.stringify(active)!==JSON.stringify(inactive)}})()`);
  const issues=[];
  if(theme.startsWith('sen-')){
   if(!commands.distinct)issues.push('palette-selection-invisible');
   if(!options.distinct)issues.push('theme-selection-invisible');
   if(text.fileName.contrast<4.5||text.fileCount.contrast<4.5)issues.push('file-text-contrast-low');
   if(frame.plot.some(x=>x.border.some(v=>parseFloat(v)>0)))issues.push('plot-border-regression');
   // The reduced fixture can shift while the real tree does not: keep the
   // measurement as a candidate, not a confirmed issue or blocking contract.
   if([frame.editor,frame.editorSurface,frame.sidebar].some(x=>x.image!=='none'))issues.push('flat-surface-overridden');
   if(commands.panel.radius!=='0px'||commands.panel.shadow!=='none')issues.push('palette-ignores-flat-style');
  }
  rows.push({theme,frame,text,options,commands,issues});console.log(theme,JSON.stringify({issues,treeShift:frame.treeShift,fileNameContrast:text.fileName.contrast,fileCountContrast:text.fileCount.contrast}));
 }
}finally{await page.close()}
await writeFile(`${directory}/contracts.json`,JSON.stringify({generatedAt:new Date().toISOString(),rows},null,2));
if(process.argv.includes('--check')&&rows.some(r=>r.issues.length))process.exitCode=1;
