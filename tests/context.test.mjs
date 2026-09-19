import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../lib/engine.mjs';
import {validateGraph} from '../lib/core.mjs';
const finish=async(e,r)=>{for(let i=0;i<100;i++){const current=e.run(r.id);if(current.status==='done')return current;if(current.status==='failed')throw new Error(current.error||'failed');await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');};
test('node files are isolated, snapshotted, persisted and invalidate descendants on retry',async t=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),'graph-context-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'shared.md'),'SHARED');fs.writeFileSync(path.join(root,'private.md'),'PRIVATE_V1');const calls=[];
const e=new Engine({dataRoot:path.join(root,'data'),libraryRoot:root,models:[{id:'claude:haiku'}],defaultModel:'claude:haiku',concurrency:2},{execute:async job=>{calls.push(job);return {ok:true,text:'result'};}});
const p=e.createProject('Context');p.attachments=['shared.md'];p.graph={nodes:[['a',[],['private.md']],['b',[],[]],['c',['a'],[]]].map(([id,dependsOn,context])=>({id,title:id,instruction:'task',model:'claude:haiku',dependsOn,context}))};e.updateProject(p.id,p);assert.deepEqual(e.project(p.id).graph.nodes[0].context,['private.md']);
const old=await finish(e,e.start(p.id));assert.match(calls.find(j=>j.title==='a').prompt,/PRIVATE_V1/);assert.doesNotMatch(calls.find(j=>j.title==='b').prompt,/PRIVATE_V1/);assert.ok(calls.every(j=>j.prompt.includes('SHARED')));fs.writeFileSync(path.join(root,'private.md'),'PRIVATE_V2');assert.match(e.run(old.id).nodeContexts.a,/PRIVATE_V1/);calls.length=0;
await finish(e,e.retry(old.id,'b'));assert.deepEqual(calls.map(j=>j.title).sort(),['a','b','c']);assert.match(calls.find(j=>j.title==='a').prompt,/PRIVATE_V2/);
p.graph.nodes[0].context=['../escape.md'];e.updateProject(p.id,p);assert.throws(()=>e.start(p.id));
});
test('invalid node attachment lists are rejected',()=>{const n={id:'a',title:'A',instruction:'task',model:'m',dependsOn:[]};for(const context of ['file.md',[null],Array(9).fill('a.md')])assert.throws(()=>validateGraph({nodes:[{...n,context}]},['m']));});
