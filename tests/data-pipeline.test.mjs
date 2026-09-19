import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../lib/engine.mjs';
import {libraryCatalog,fileReference,catalogAllowsReference,referenceContext,referenceText} from '../lib/library.mjs';
import {validateGraph} from '../lib/core.mjs';
import {hash,workspaceFingerprint} from '../lib/data-pipeline.mjs';
import {safePath} from '../lib/storage.mjs';

const node=(id,dependsOn=[],extra={})=>({id,title:id,instruction:'Task',model:'claude:haiku',dependsOn,...extra});
function setup(t,execute){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'graph-pipeline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config={libraryRoot:root,dataRoot:path.join(root,'data'),models:[{id:'claude:haiku'}],defaultModel:'claude:haiku',concurrency:2};
  const calls=[];const e=new Engine(config,{execute:async job=>{calls.push(job);fs.mkdirSync(job.workingDirectory||path.join(job.dir,'work'),{recursive:true});return execute?execute(job):{ok:true,text:'result'};}});
  const p=e.createProject();p.request='Task';return {root,config,e,p,calls};
}
async function finish(e,r){for(let i=0;i<400;i++){if(!e.busy.has(r.id))return e.run(r.id);await new Promise(resolve=>setTimeout(resolve,5));}throw Error('timeout');}

test('C# reads and snapshots; explicitly unsupported files fail visibly',t=>{
  const {root,config}=setup(t);fs.writeFileSync(path.join(root,'read.cs'),'C_SHARP_SOURCE');fs.writeFileSync(path.join(root,'binary.bin'),'binary');
  assert.match(referenceContext(config,['read.cs']),/C_SHARP_SOURCE/);assert.equal(referenceText(config,'read.cs'),'C_SHARP_SOURCE');
  assert.throws(()=>referenceContext(config,['binary.bin']),/Неподдерживаемый формат/);
});
test('compact catalog keeps full skill descriptions and permits scoped resource discovery',t=>{
  const {root,config}=setup(t);const skills=path.join(root,'skills'),dir=path.join(skills,'levels');fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});
  const description='Important scope '.repeat(25)+'Do not use for IFC-only changes.';
  fs.writeFileSync(path.join(dir,'SKILL.md'),'---\nname: levels\ndescription: >-\n  '+description+'\n---\nBody');
  fs.writeFileSync(path.join(dir,'scripts','read.cs'),'source');fs.writeFileSync(path.join(root,'outside.md'),'outside');
  const c=libraryCatalog(config,[fileReference(skills)]);
  assert.equal(c.files.length,1);assert.equal(c.files[0].description,description);
  assert.equal(catalogAllowsReference(config,c,fileReference(path.join(dir,'scripts','read.cs'))),true);
  assert.equal(catalogAllowsReference(config,c,fileReference(path.join(root,'outside.md'))),false);
  assert.equal(catalogAllowsReference(config,c,fileReference(path.join(dir,'missing.cs'))),false);
});
test('all long dependencies survive on disk including a fact in the middle and a late branch',async t=>{
  const a='a'.repeat(65000)+'MIDDLE_FACT'+'z'.repeat(65000),b='SECOND_BRANCH_FACT';
  const {e,p,calls}=setup(t,async j=>({ok:true,text:j.title==='a'?a:j.title==='b'?b:'final'}));
  p.graph={nodes:[node('a'),node('b'),node('join',['a','b'])]};e.saveProject(p);
  const r=await finish(e,e.start(p.id));assert.equal(r.status,'done');
  const join=calls.find(j=>j.title==='join'),m=JSON.parse(fs.readFileSync(path.join(join.dir,'dependency-inputs.json')));
  assert.equal(m.dependencies.length,2);assert.match(join.prompt,/SECOND_BRANCH_FACT/);
  assert.equal(m.dependencies[0].truncated,true);assert.equal(fs.readFileSync(m.dependencies[0].fullTextPath,'utf8'),a);
  assert.equal(hash(fs.readFileSync(m.dependencies[0].fullTextPath)),m.dependencies[0].sha256);
  assert.ok(m.dependencies.every(d=>d.fullTextPath.startsWith(path.join(join.dir,'work'))));
  assert.ok(r.states.join.inputMetrics.dependencyFullChars>130000);
  assert.ok(r.states.join.inputMetrics.dependencyInlineChars<30000);
});
test('workspace changes invalidate start and retry; unchanged workspace retains reuse',async t=>{
  const {root,e,p,calls}=setup(t);const work=path.join(root,'work');fs.mkdirSync(work);const source=path.join(work,'source.txt');fs.writeFileSync(source,'v1');
  p.workingDirectory=work;p.graph={nodes:[node('a'),node('b',['a'])]};e.saveProject(p);
  const first=await finish(e,e.start(p.id));calls.length=0;await finish(e,e.start(p.id));assert.equal(calls.length,0);
  fs.writeFileSync(source,'v2');calls.length=0;const next=await finish(e,e.start(p.id));assert.deepEqual(calls.map(j=>j.title),['a','b']);
  assert.notEqual(first.workspaceAfter.digest,next.workspaceAfter.digest);
  fs.writeFileSync(source,'v3');calls.length=0;await finish(e,e.retry(next.id,'b'));assert.deepEqual(calls.map(j=>j.title),['a','b']);
});
test('incomplete fingerprint fails closed without blocking execution',t=>{
  const {root}=setup(t),file=path.join(root,'large.bin');const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,129*1024*1024);fs.closeSync(fd);
  const stamp=workspaceFingerprint(root);assert.equal(stamp.complete,false);assert.match(stamp.reason,/128/);
});
test('missing declared output fails and blocks descendants despite success text',async t=>{
  const {e,p}=setup(t,async()=>({ok:true,text:'Created report.csv, checked everything.'}));
  p.graph={nodes:[node('a',[],{requiredOutputs:['report.csv']}),node('b',['a'])]};e.saveProject(p);
  const r=await finish(e,e.start(p.id));assert.equal(r.status,'failed');assert.equal(r.states.a.verification,'failed');assert.equal(r.states.b.status,'blocked');
});
test('declared artifacts are checked, copied to consumer and invalidate reuse when changed',async t=>{
  const {e,p,calls}=setup(t,async j=>{if(j.title==='a')fs.writeFileSync(path.join(j.dir,'work','report.csv'),'id,value\n1,2');return {ok:true,text:'created report.csv'};});
  p.graph={nodes:[node('a',[],{requiredOutputs:['report.csv']}),node('b',['a'])]};e.saveProject(p);
  const first=await finish(e,e.start(p.id));assert.equal(first.status,'done');assert.equal(first.states.a.verification,'files-checked');
  const consumer=calls.find(j=>j.title==='b'),m=JSON.parse(fs.readFileSync(path.join(consumer.dir,'dependency-inputs.json')));
  assert.equal(fs.readFileSync(m.dependencies[0].artifacts[0].path,'utf8'),'id,value\n1,2');
  fs.writeFileSync(first.states.a.artifacts[0].path,'changed');calls.length=0;
  await finish(e,e.start(p.id));assert.deepEqual(calls.map(j=>j.title),['a','b']);
});
test('reused dependency manifest points to the original producing run',async t=>{
  const {e,p}=setup(t);p.graph={nodes:[node('a'),node('b',['a'])]};e.saveProject(p);const first=await finish(e,e.start(p.id));
  const second=await finish(e,e.retry(first.id,'b'));const m=JSON.parse(fs.readFileSync(e.file('runs',second.id,'b','dependency-inputs.json')));
  assert.equal(m.dependencies[0].sourceRunId,first.id);assert.equal(second.states.a.reusedFrom,first.id);
});
test('master continuation preserves late dependency and complete long text',async t=>{
  const text='a'.repeat(130000)+'TAIL';const {e,p,calls}=setup(t,async j=>j.kind==='planner'?{ok:true,text:JSON.stringify({nodes:[node('next')]})}:{ok:true,text:j.title==='a'?text:j.title==='b'?'LATE_BRANCH':'result'});
  p.graph={nodes:[node('a'),node('b'),node('master',['a','b'],{type:'master',instruction:'Continue'})]};e.saveProject(p);
  const r=await finish(e,e.start(p.id));assert.equal(r.status,'done');const plan=calls.find(j=>j.kind==='planner');assert.match(plan.prompt,/LATE_BRANCH/);
  const m=JSON.parse(fs.readFileSync(path.join(plan.dir,'dependency-inputs.json')));assert.equal(fs.readFileSync(m.dependencies[0].fullTextPath,'utf8'),text);
});
test('output paths cannot escape workspace or masquerade as master contracts',()=>{
  for(const output of ['../x','/tmp/x','C:\\x','dir/../../x','.graph-inputs/x'])assert.throws(()=>validateGraph({nodes:[node('a',[],{requiredOutputs:[output]})]},['claude:haiku']));
  assert.throws(()=>validateGraph({nodes:[node('a',[],{type:'master',requiredOutputs:['x']})]},['claude:haiku']));
});
test('new input destinations cannot escape through an existing directory junction',t=>{
  const {root}=setup(t),inside=path.join(root,'inside'),outside=path.join(root,'outside');fs.mkdirSync(inside);fs.mkdirSync(outside);
  try{fs.symlinkSync(outside,path.join(inside,'.graph-inputs'),process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('symlink permission unavailable');return;}throw e;}
  assert.throws(()=>safePath(inside,'.graph-inputs/new-run/node/file.md'),/Ссылка/);
  assert.equal(fs.existsSync(path.join(outside,'new-run')),false);
});
