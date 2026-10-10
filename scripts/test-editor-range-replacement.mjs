import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import { history, undo, redo, closeHistory } from "@tiptap/pm/history";
import { loadEditorAuditModule, decorationSignature } from "./lib/editor-audit-module.mjs";

const api = await loadEditorAuditModule();
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
const docOf = text => schema.node("doc", null, text.split("\n").map(line=>schema.node("paragraph",null,line ? schema.text(line) : undefined)));
const textOf = doc => doc.textBetween(0,doc.content.size,"\n");
const originals=["","a","\n","a\n\n\nb","# h\n**b**","😀e\u0301\n東京","a\nb\nc"];
const inserts=["","a","\n","\n\n","x\ny","**b**","\r","\r\n","😀","　","e\u0301"];
let checks=0;
for(const full of [false,true])for(const original of originals){
  const state=EditorState.create({schema,doc:docOf(original)});
  let ast=api.makeAstState(state);
  if(full){const tr=state.tr.setMeta(api.astKey,{fullDecorations:true});ast=api.applyAst(tr,ast,state,state.apply(tr));}
  for(let from=0;from<=original.length;from++)for(let to=from;to<=original.length;to++)for(const insert of inserts){
    const normalized=insert.replace(/\r\n?/g,"\n");
    const expected=original.slice(0,from)+normalized+original.slice(to);
    for(const cursor of [from+normalized.length,-1,expected.length+20]){
      const tr=api.replaceTextRangeTransaction(state.tr,from,to,insert,cursor);
      const next=state.apply(tr);
      const updated=api.applyAst(tr,ast,state,next);
      assert.equal(textOf(next.doc),expected,JSON.stringify({original,from,to,insert}));
      assert.equal(updated.text,expected,JSON.stringify({original,from,to,insert,cursor,steps:tr.steps.map(s=>s.toJSON()),lines:updated.lines.map(l=>l.source)}));
      assert.equal(api.textOffsetFromPmPos(next.doc,next.selection.head),Math.max(0,Math.min(expected.length,cursor)));
      assert.equal(tr.getMeta("preventUpdate"),true,"the handle keeps its single explicit update notification");
      assert.deepEqual(decorationSignature(updated.decoSet),decorationSignature(api.buildWindowDecos(next.doc,updated.lines,updated.tableRows,updated.activeIndex,updated.visibleCenter,updated.fullDecorations,updated.commentsHidden)));
      checks++;
    }
  }
}
let historyChecks=0;
for(const [original,from,to,insert] of [["a\n\n\nb",2,2,"\n"],["a\nb\nc",1,4,"x\ny"],["**太字**",0,6,"太字"],["😀\n東京",2,4,""],["a\nb",0,3,""],["a\nb",0,3,"x\ny\nz"]]){
  let state=EditorState.create({schema,doc:docOf(original),plugins:[new Plugin({key:api.astKey,state:{init:(_config,state)=>api.makeAstState(state),apply:api.applyAst}}),history()]});
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,api.pmPosFromTextOffset(state.doc,from),api.pmPosFromTextOffset(state.doc,to))));
  const beforeSelection=state.selection.toJSON();
  state=state.apply(closeHistory(api.replaceTextRangeTransaction(state.tr,from,to,insert,from+insert.length)));
  const afterText=textOf(state.doc),afterSelection=state.selection.toJSON();
  assert.ok(undo(state,tr=>{state=state.apply(tr);}));
  assert.equal(textOf(state.doc),original);
  assert.deepEqual(state.selection.toJSON(),beforeSelection);
  assert.ok(redo(state,tr=>{state=state.apply(tr);}));
  assert.equal(textOf(state.doc),afterText);
  assert.deepEqual(state.selection.toJSON(),afterSelection);
  historyChecks++;
}
const state=EditorState.create({schema,doc:docOf(Array.from({length:2400},(_,i)=>`段落${i} **太字**`).join("\n"))});
let offset=0;for(let i=0;i<1200;i++)offset+=state.doc.child(i).content.size+1;
const tr=api.replaceTextRangeTransaction(state.tr,offset,offset,"追",offset+1);
assert.equal(tr.doc.child(100),state.doc.child(100));
assert.equal(tr.doc.child(2300),state.doc.child(2300));
assert.equal(tr.mapping.maps.length,1,"a range command is a single precise replacement");
const current=textOf(state.doc);
const fullSync=api.replaceTextRangeTransaction(state.tr,0,current.length,current.slice(0,offset)+'追'+current.slice(offset),offset+1,current);
assert.equal(textOf(fullSync.doc),textOf(tr.doc));
assert.equal(fullSync.doc.child(100),state.doc.child(100));
assert.equal(fullSync.doc.child(2300),state.doc.child(2300));
assert.deepEqual(fullSync.steps.map(step=>step.toJSON()),tr.steps.map(step=>step.toJSON()),'a whole-text request with one edit must produce the same narrow transaction');
console.log(JSON.stringify({checks,historyChecks,unchangedParagraphNodesRetained:true,wholeTextSyncUsesExactRange:true}));
