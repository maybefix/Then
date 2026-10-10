import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function moduleOf(file){
  const result=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const {VisualLineIndex}=await moduleOf('src/editor/visualLineIndex.ts');
const {createVisualLineBands}=await moduleOf('src/editor/visualLineLayout.ts');
let comparisons=0;
for(const mode of ['vertical-rl','horizontal-tb'])for(const seed of [7,42,9871]){
  let randomState=seed,id=0,revision=0;
  const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
  const make=()=>({key:++id,version:0,lines:Math.floor(random()*5),unnumbered:random()<.2,overflow:random()<.3});
  let records=Array.from({length:45},make);
  const index=new VisualLineIndex();
  index.reset(records.map(r=>r.key));
  for(let step=0;step<300;step++){
    if(step%11===0){
      const at=Math.floor(random()*records.length);
      records.splice(at,Math.floor(random()*3),...Array.from({length:Math.floor(random()*4)},make));
      if(!records.length)records.push(make());
      index.reset(records.map(r=>r.key));
    }else if(step%17===0){
      records.reverse();index.reset(records.map(r=>r.key));
    }else if(step%23===0)revision++;
    else {
      const r=records[Math.floor(random()*records.length)];
      r.version++;r.lines=Math.floor(random()*6);r.unnumbered=random()<.2;r.overflow=random()<.5;
    }
    const rootX=random()*150-75,rootY=random()*200-100;
    let cursor=0;
    const blocks=records.map(r=>{
      const pitch=23.4375,extent=r.lines*pitch;
      const block=mode==='vertical-rl'
        ? {left:rootX-cursor-extent,right:rootX-cursor,top:rootY,bottom:rootY+401.125}
        : {left:rootX,right:rootX+401.125,top:rootY+cursor,bottom:rootY+cursor+extent};
      cursor+=extent+7.125;
      const fragments=[];
      // Interleaved span/ruby rectangles: the same rendered line is not adjacent.
      for(let part=0;part<3;part++)for(let line=0;line<r.lines;line++){
        fragments.push(mode==='vertical-rl'
          ? {left:block.right-(line+1)*pitch-(r.overflow?2.25:0),right:block.right-line*pitch,
            top:block.top+part*110,bottom:block.top+(part+1)*110}
          : {left:block.left+part*110,right:block.left+(part+1)*110,
            top:block.top+line*pitch,bottom:block.top+(line+1)*pitch+(r.overflow?2.25:0)});
      }
      if(!r.lines)block.bottom=block.top; // A folded/hidden paragraph has no bands.
      return {...block,fragments,unnumbered:r.unnumbered};
    });
    for(let i=0;i<records.length;i++){
      const r=records[i];
      index.measure(i,blocks[i],r.version,revision,mode,r.unnumbered,()=>blocks[i].fragments);
    }
    const expected=createVisualLineBands(blocks,mode);
    const actual=blocks.flatMap((block,i)=>index.bandsAt(i,block));
    assert.equal(actual.length,expected.length);
    for(let i=0;i<expected.length;i++)for(const key of Object.keys(expected[i])){
      if(['number','blockIndex','lineIndex'].includes(key))assert.equal(actual[i][key],expected[i][key]);
      else assert.ok(Math.abs(actual[i][key]-expected[i][key])<1e-7,`${mode} step ${step} band ${i} ${key}`);
    }
    const viewport={left:rootX-200,right:rootX+300,top:rootY+50,bottom:rootY+300};
    for(let i=0;i<blocks.length;i++){
      const hasVisible=expected.some(b=>b.blockIndex===i&&b.right>=viewport.left&&b.left<=viewport.right&&b.bottom>=viewport.top&&b.top<=viewport.bottom);
      if(hasVisible)assert.ok(index.intersects(i,blocks[i],viewport),'overflow or partial bands must not be culled');
    }
    comparisons++;
  }
}
// Positive/negative controls for expensive fragment reads and suffix numbering.
const count=2400,index=new VisualLineIndex();
const keys=Array.from({length:count},()=>({}));
const block={left:0,right:30,top:0,bottom:400};
const fragments=[{left:0,right:30,top:0,bottom:400}];
index.reset(keys);
let reads=0;
const read=()=>{reads++;return fragments;};
for(let i=0;i<count;i++)index.measure(i,block,0,0,'vertical-rl',false,read);
assert.equal(reads,count);
reads=0;
for(let i=0;i<count;i++)index.measure(i,{...block,left:100,right:130},i===1200?1:0,0,'vertical-rl',false,read);
assert.equal(reads,1,'a local edit must not re-read the other 2399 paragraph fragments');
assert.equal(index.bandsAt(2399,block)[0].number,2400);
index.measure(10,block,1,0,'vertical-rl',true,read);
assert.equal(index.bandsAt(2399,block)[0].number,2399,'an unnumbered comment shifts the suffix without regrouping it');
reads=0;
for(let i=0;i<count;i++)index.measure(i,block,i===1200||i===10?1:0,1,'vertical-rl',i===10,read);
assert.equal(reads,count,'a global font/layout revision must remeasure all paragraphs');
index.reset([]);
assert.deepEqual(index.bandsAt(0,block),[]);
console.log(JSON.stringify({comparisons,largeDocumentParagraphs:count,localFragmentReads:1,globalFragmentReads:count,findings:0}));
