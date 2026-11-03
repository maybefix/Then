// Real-app visual audit. Uses only the in-memory preview IPC fixture.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { writeAuditFile as writeFile } from "./lib/write-audit-file.mjs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { guardBrowser, stopBrowser } from "./lib/stop-browser.mjs";

const directory=path.resolve('docs/shuboku-audit');await mkdir(directory,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});await server.listen();
const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert.ok(edge);
const profile=mkdtempSync(path.join(os.tmpdir(),'then-shuboku-audit-')),port=11000+Math.floor(Math.random()*1000);
const browser=spawn(edge,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-extensions','--disable-background-timer-throttling','about:blank'],{stdio:'ignore',windowsHide:true});guardBrowser(browser,profile);
console.log(`AUDIT SERVER ${origin}, CDP ${port}`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
const cases=[],errors=[];

// Read the real DOM's paint/state/layout. Contrast values are screening signals;
// keep text/class/color evidence so each signal can be reviewed in a screenshot.
function measure(){
 const selectors=['.appFrame','.workspace','.leftWorkspaceCluster','.workspaceSidebar','.rightSidebar','.editorColumn','.verticalTypewriterShell','.ProseMirror','.statusbar','.plotPane','.plotCard','.plotCardNum','.plotCardTitle','.plotCardBody','.plotToolButton','.modal','.modalBackdrop','.themeOption:has(input:checked)','.ideaCard','.propertiesPanel','.proofPane','.commandPalette','.editorContextMenu','.pagedEditorSheet','.editorFindPopover'];
 const css=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,classes:e.className,color:s.color,background:s.backgroundColor,backgroundImage:s.backgroundImage,border:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth],borderColor:[s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor],radius:s.borderRadius,shadow:s.boxShadow,outline:s.outline,outlineOffset:s.outlineOffset,opacity:s.opacity,display:s.display,visibility:s.visibility,z:s.zIndex,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}};
 const styles=Object.fromEntries(selectors.map(s=>[s,[...document.querySelectorAll(s)].slice(0,5).map(css)]));
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const colorCache=new Map();
 const parse=text=>{if(colorCache.has(text))return colorCache.get(text);ctx.clearRect(0,0,1,1);ctx.fillStyle=text;ctx.fillRect(0,0,1,1);const d=ctx.getImageData(0,0,1,1).data;const value={r:d[0],g:d[1],b:d[2],a:d[3]/255};colorCache.set(text,value);return value};
 const over=(a,b)=>({r:a.r*a.a+b.r*(1-a.a),g:a.g*a.a+b.g*(1-a.a),b:a.b*a.a+b.b*(1-a.a),a:1});
 const surface=(el)=>{const layers=[];for(;el;el=el.parentElement){const s=getComputedStyle(el),bg=parse(s.backgroundColor);
   if(s.backgroundImage!=='none'){
    const colors=[...s.backgroundImage.matchAll(/(?:rgba?|color)\([^)]+\)/g)].map(m=>parse(m[0]));
    if(!s.backgroundImage.startsWith('linear-gradient')||!colors.length||colors.some(c=>JSON.stringify(c)!==JSON.stringify(colors[0])))return null;
    layers.push(colors[0]);
   }
   if(bg.a>0){layers.push(bg);if(bg.a>=1)break;}
  }return layers.reduceRight((b,a)=>over(a,b),{r:255,g:255,b:255,a:1});};
 const lum=c=>['r','g','b'].reduce((v,k,i)=>{const n=c[k]/255;return v+[.2126,.7152,.0722][i]*(n<=.04045?n/12.92:((n+.055)/1.055)**2.4)},0);
 const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 const lowContrast=[],screened=[];const seen=new Set();
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 for(let n=walker.nextNode();n;n=walker.nextNode()){
  const text=n.textContent.trim();if(!text||!/[A-Za-z0-9ぁ-鿿]/.test(text)||['SCRIPT','STYLE'].includes(n.parentElement.tagName))continue;
  const el=n.parentElement,s=getComputedStyle(el);if(el.closest('[disabled],[aria-hidden="true"]'))continue;
  let opacity=1;for(let p=el;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);
  if(opacity<.95||s.display==='none'||s.visibility!=='visible')continue;
  const range=document.createRange();range.setStart(n,0);range.setEnd(n,Math.min(n.length,2));const r=range.getClientRects()[0];
  if(!r||r.width===0||r.height===0)continue;const x=r.left+r.width/2,y=r.top+r.height/2;
  if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
  const hit=document.elementFromPoint(x,y);if(!hit||(!el.contains(hit)&&!hit.contains(el)))continue;
  const bg=surface(el);if(!bg)continue;const fg=over(parse(s.color),bg);const value=ratio(fg,bg);
  const key=el.tagName+'.'+el.className+':'+text.slice(0,24);if(seen.has(key))continue;seen.add(key);
  const item={text:text.slice(0,64),tag:el.tagName,classes:el.className,fontSize:s.fontSize,color:s.color,background:bg,contrast:+value.toFixed(3)};
  screened.push(item);if(value<4.5)lowContrast.push(item);
 }
 const controls=[...document.querySelectorAll('button,input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility==='visible'&&r.bottom>0&&r.top<innerHeight}).slice(0,130).map(e=>({tag:e.tagName,classes:e.className,aria:e.getAttribute('aria-label'),title:e.title,text:e.textContent.trim().slice(0,35),type:e.type}));
 const activeOption=document.querySelector('.commandPaletteItem.active');let paletteSelection=null;
 if(activeOption){const read=()=>{const s=getComputedStyle(activeOption);return {background:s.backgroundColor,color:s.color,border:s.border,borderLeft:s.borderLeft,markerPainted:parseFloat(s.borderLeftWidth)>=3&&s.borderLeftStyle==='solid'&&parse(s.borderLeftColor).a>.95,outline:s.outline,shadow:s.boxShadow}};const active=read();activeOption.classList.remove('active');const inactive=read();activeOption.classList.add('active');paletteSelection={text:activeOption.textContent.trim(),disabled:activeOption.getAttribute('aria-disabled')==='true',active,inactive,visuallyDistinct:JSON.stringify(active)!==JSON.stringify(inactive)};}
 return {theme:document.querySelector('.appShell').dataset.theme,styles,lowContrast,screenedCount:screened.length,controls,paletteSelection,
  active:{tag:document.activeElement.tagName,classes:document.activeElement.className,focusVisible:document.activeElement.matches(':focus-visible')},
  pageOverflow:{width:document.documentElement.scrollWidth,viewport:innerWidth,height:document.documentElement.scrollHeight},
  plotToolButtonCount:document.querySelectorAll('.plotToolButton').length};
}

try{
 let target;for(let i=0;i<80;i++){try{target=await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json());break}catch{await sleep(150)}}assert.ok(target);
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);let id=0;const pending=new Map();
 socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);const q=pending.get(m.id);if(!q)return;pending.delete(m.id);clearTimeout(q.timer);m.error?q.reject(new Error(m.error.message)):q.resolve(m.result)};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;const timer=setTimeout(()=>{pending.delete(next);reject(new Error(`CDP timeout: ${method}`))},60000);pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const key=async(name,code,keyCode,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode,modifiers});await sleep(150)};
 const click=selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing ${selector}');e.click();return true})()`);
 const wait=async selector=>{for(let i=0;i<60;i++){if(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`))return;await sleep(100)}throw Error('Not rendered: '+selector)};
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 const load=async(theme,extra='')=>{
  console.log(`LOAD ${theme}${extra}`);
  await send('Page.navigate',{url:`${origin}/docs/theme-mockups/pink-proposals/preview.html?app-theme=${theme}&audit=1&typewriter=1${extra}`});
  await sleep(1000); // Let the navigation replace the old execution context first.
  for(let i=0;i<100;i++){const ready=await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='あとで')?.click();return !!document.querySelector('.ProseMirror')&&document.querySelector('.appShell').dataset.theme===${JSON.stringify(theme)}})()`);if(ready)break;await sleep(100)}
  await wait('.ProseMirror');console.log(`READY ${theme}`);await evaluate('Promise.race([document.fonts.ready.then(()=>true),new Promise(r=>setTimeout(()=>r(false),8000))])');await sleep(200);
  await evaluate(`(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';document.head.append(s);return true})()`);
 };
 const record=async(theme,name,extra={})=>{console.log(`MEASURE ${theme}/${name}`);const data=await evaluate(`(${measure.toString()})()`);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const filename=`${theme}-${name}.png`;await writeFile(path.join(directory,filename),Buffer.from(shot.data,'base64'));cases.push({theme,name,screenshot:filename,...extra,...data});await writeFile(path.join(directory,`${theme}-${name}.json`),JSON.stringify(cases[cases.length-1],null,2));console.log(`CASE ${theme}/${name}: ${data.screenedCount} visible text samples; ${data.lowContrast.length} below 4.5`)};
 const attempt=async(theme,name,run)=>{try{await run()}catch(error){cases.push({theme,name,error:String(error)});console.error(`CASE ERROR ${theme}/${name}: ${error.message}`)}};
 for(const theme of process.argv.includes('--probe')?['standard','sen-light']:['sen-light','sen-dark','standard','dark']){
  await load(theme);
  await record(theme,'vertical');
  if(process.argv.includes('--probe'))continue;
  // Prove whether active registration marks shift file names in the real tree.
  const treeShift=await evaluate(`(async()=>{const rows=[...document.querySelectorAll('.fileTreeItem')];const row=rows[1],name=row?.querySelector('.treeItemName');if(!name)return null;const title=name.textContent,before=name.getBoundingClientRect().x;row.querySelector('.treeItemPrimary').click();await new Promise(r=>setTimeout(r,250));const after=[...document.querySelectorAll('.fileTreeItem .treeItemName')].find(e=>e.textContent===title);return {name:title,before,after:after?.getBoundingClientRect().x,shift:after?after.getBoundingClientRect().x-before:null}})()`);
  await record(theme,'tree-selection',{treeShift});
  await attempt(theme,'theme-picker',async()=>{await click('button[aria-label="テーマを選択"]');await wait('.themePickerModal');
   await evaluate(`(()=>{document.querySelector('input[name="theme"]:checked').focus();return true})()`);await key('Tab','Tab',9,1);await key('Tab','Tab',9);
   const optionStates=await evaluate(`(()=>{const input=document.querySelector('input[name="theme"]:checked'),label=input.closest('label');label.scrollIntoView({block:'center'});const fields=e=>{const s=getComputedStyle(e);return {border:s.border,borderColor:s.borderColor,background:s.backgroundColor,shadow:s.boxShadow,outline:s.outline,opacity:s.opacity}};const checked=fields(label);input.checked=false;const unchecked=fields(label);input.checked=true;input.focus();return {checked,unchecked,focused:fields(label),input:fields(input),focusVisible:input.matches(':focus-visible')}})()`);
   await record(theme,'theme-picker',{optionStates});if(theme.startsWith('sen-')){assert.equal(cases.at(-1).styles['.themeOption:has(input:checked)'][0].border[3],'3px','Selected theme must paint its registration mark');assert.notEqual(optionStates.checked.borderColor,optionStates.unchecked.borderColor);assert.ok(optionStates.focusVisible,'Keyboard navigation must focus the theme radio');assert.match(optionStates.focused.outline,/solid 2px/,'Theme keyboard focus must be visible');}await click('button[aria-label="テーマ選択を閉じる"]');});
  if(theme==='standard'||theme==='dark')continue;
  for(const [name,query] of [['horizontal','&writing=horizontal'],['paged-vertical','&display=paged'],['paged-horizontal','&display=paged&writing=horizontal'],['manuscript','&manuscript=1'],['ui-scale-150','&scale=1.5']]){
   await attempt(theme,name,async()=>{await load(theme,query);await record(theme,name)});
  }
  await load(theme);
  await attempt(theme,'plot-focus',async()=>{const fields=await evaluate(`(()=>{const e=document.querySelector('.plotCardTitle');const read=()=>{const s=getComputedStyle(e);return {border:s.border,outline:s.outline,shadow:s.boxShadow,background:s.backgroundColor,color:s.color}};const before=read();e.focus();return {tag:e.tagName,before,after:read(),focusVisible:e.matches(':focus-visible')}})()`);await record(theme,'plot-focus',{fields})});
  for(const name of ['バインダー','校正','プロパティ']){
   await attempt(theme,name,async()=>{await click('.rightSidebar .rightPaneSwitcherButton');await sleep(100);await evaluate(`(()=>{const e=[...document.querySelectorAll('.rightSidebar [role="menuitemradio"]')].find(b=>b.textContent.trim()===${JSON.stringify(name)});if(!e)throw Error('Missing pane');e.click();return true})()`);await sleep(name==='校正'?700:250);await record(theme,name)});
  }
  await attempt(theme,'settings',async()=>{await click('button[aria-label="設定"]');await wait('.settingsModal');await record(theme,'settings');await key('Escape','Escape',27)});
  await attempt(theme,'command-palette',async()=>{await key('p','KeyP',80,2);await wait('.commandPalette');const before=await evaluate(`document.querySelector('.commandPaletteItem.active').textContent.trim()`);await key('ArrowDown','ArrowDown',40);const after=await evaluate(`document.querySelector('.commandPaletteItem.active').textContent.trim()`);assert.notEqual(after,before,'ArrowDown must move the active command');await record(theme,'command-palette',{keyboardNavigation:{before,after,moved:before!==after}});const state=cases.at(-1).paletteSelection;assert.ok(state.active.markerPainted&&!state.inactive.markerPainted,'Active command must paint its selection mark');if(state.disabled)assert.equal(state.active.color,state.inactive.color,'Selecting a disabled command must retain its muted text');await key('Escape','Escape',27)});
  await attempt(theme,'find',async()=>{await key('f','KeyF',70,2);await wait('.editorFindPopover');await record(theme,'find');await key('Escape','Escape',27)});
  await attempt(theme,'editor-context',async()=>{const point=await evaluate(`(()=>{const e=document.querySelector('.ProseMirror p'),r=e.getBoundingClientRect();return {x:Math.min(1200,Math.max(450,r.left+8)),y:Math.min(850,Math.max(180,r.top+20))}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',clickCount:1,x:point.x,y:point.y});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',clickCount:1,x:point.x,y:point.y});await wait('.editorContextMenu');await record(theme,'editor-context');await key('Escape','Escape',27)});
  await load(theme);
  await attempt(theme,'focus-mode',async()=>{await click('.editorFocusModeButton');await sleep(300);await record(theme,'focus-mode')});
 }
}catch(error){console.error(error);errors.push({auditError:String(error)})}
finally{await writeFile(path.join(directory,process.argv.includes('--probe')?'browser-probe.json':'browser.json'),JSON.stringify({generatedAt:new Date().toISOString(),cases,runtimeErrors:errors},null,2));socket?.close();await stopBrowser(browser,profile);await server.close()}
console.log(`Saved ${cases.length} scenes; ${cases.filter(c=>c.error).length} case errors; ${errors.length} runtime exceptions. ${directory}`);
if(errors.length||cases.some(c=>c.error))process.exitCode=1;
