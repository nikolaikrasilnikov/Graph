import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../lib/engine.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function finish(engine,run){for(let i=0;i<100;i++){const r=engine.run(run.id);if(r.status==='done')return r;if(r.status==='failed')throw new Error(r.error);await sleep(10);}throw new Error('timeout');}
test('changed ancestor invalidates its downstream cached results',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'graph-retry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[];
 const engine=new Engine({dataRoot:root,libraryRoot:root,models:[{id:'claude:haiku'}],defaultModel:'claude:haiku',concurrency:2},{execute:async job=>{calls.push(job.title);return{ok:true,text:'result'};}});
 const p=engine.createProject('Retry');p.graph={nodes:[['a',[]],['b',['a']],['c',[]],['d',['b','c']]].map(([id,dependsOn])=>({id,title:id,instruction:'initial',dependsOn,model:'claude:haiku'}))};engine.saveProject(p);
 const old=await finish(engine,engine.start(p.id));p.graph.nodes[0].instruction='changed';engine.updateProject(p.id,{graph:p.graph});calls.length=0;
 await finish(engine,engine.retry(old.id,'c'));assert.deepEqual(calls.sort(),['a','b','c','d']);
});
