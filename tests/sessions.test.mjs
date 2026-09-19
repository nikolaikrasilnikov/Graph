import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {Engine} from '../lib/engine.mjs';
import {Sessions} from '../lib/sessions.mjs';
import {Workspaces} from '../lib/workspaces.mjs';
import {readJSON,writeJSON} from '../lib/storage.mjs';
import {publicEvent} from '../lib/session-events.mjs';
import {runJob,agentArgs} from '../lib/worker-runtime.mjs';
import {validateLayout,removeLeaf,splitLeaf,leaves} from '../workspace-layout.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await sleep(20);}throw new Error('Condition timed out');}
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'graph-sessions-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const config={dataRoot:root,libraryRoot:root,models:[{id:'codex:test'}],defaultModel:'codex:test',timeoutMs:3000,concurrency:2},engine=new Engine(config,{}),p=engine.createProject('Sessions');p.graph={nodes:[{id:'a',title:'A',instruction:'Task',model:'codex:test',dependsOn:[]}]};engine.saveProject(p);const run=engine.makeRun(p,'execution',p.graph);run.status='running';run.states.a.status='running';engine.saveRun(run);const dir=engine.file('runs',run.id,'a');fs.mkdirSync(dir,{recursive:true});return {root,config,engine,p,run,dir};}
function fakeProcess(record){let child,turn=0;return {spawnProcess(exe,args){turn++;child=new EventEmitter();child.pid=100+turn;child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();let input='';child.stdin=new Writable({write(chunk,enc,cb){input+=chunk;cb();},final(cb){record.push({args,input});cb();const current=child;setTimeout(()=>current.stdout.write(JSON.stringify({type:'thread.started',thread_id:'session_12345678'})+'\n'),5);if(turn>1)setTimeout(()=>{current.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Corrected result'}})+'\n');current.exitCode=0;current.emit('close',0);},150);}});return child;},async stopProcess(target){await sleep(30);target.exitCode=1;target.emit('close',1);}};}

test('worker records actual prompt and observed environment without MCP connection secrets',async t=>{
 const {dir,config}=setup(t);let sent='';
 const spawnProcess=()=>{const child=new EventEmitter();child.pid=123;child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new Writable({write(chunk,enc,cb){sent+=chunk;cb();},final(cb){cb();setTimeout(()=>{child.stdout.write(JSON.stringify({type:'system',subtype:'init',model:'resolved-model',claude_code_version:'fixture',tools:['Read'],mcp_servers:[{name:'test',status:'connected',token:'secret-do-not-copy'}]})+'\n');child.stdout.write(JSON.stringify({type:'result',result:'Done'})+'\n');child.exitCode=0;child.emit('close',0);},10);}});return child;};
 const result=await runJob({dir,config,model:'claude:haiku',prompt:'Task',kind:'planner'},{spawnProcess});
 assert.equal(result.ok,true);assert.equal(fs.readFileSync(path.join(dir,'prompts','1.md'),'utf8'),sent);
 const env=readJSON(path.join(dir,'environment.json'));assert.deepEqual(env.tools,['Read']);assert.equal(env.resolvedModel,'resolved-model');assert.equal(JSON.stringify(env).includes('secret-do-not-copy'),false);
});

test('pause is confirmed only after process exit; exact session resumes and correction becomes final output',async t=>{const {engine,run,dir,config}=setup(t),api=new Sessions(engine),record=[],fake=fakeProcess(record);const task=runJob({dir,config,model:'codex:test',prompt:'Original task',kind:'execution'},fake);await until(()=>readJSON(path.join(dir,'live.json'))?.sessionId);const pause=api.control(run.id,'a',{action:'pause'});assert.equal(pause.status,'queued');assert.notEqual(api.status(run.id,'a').status,'paused');await until(()=>api.status(run.id,'a').status==='paused');assert.equal(fs.existsSync(path.join(dir,'result.json')),false,'dependencies cannot advance while paused');await sleep(120);assert.equal(record.length,1);const message=api.control(run.id,'a',{action:'message',text:'Use neutral backgrounds'});await until(()=>api.status(run.id,'a').receipt?.status==='delivered');assert.equal(api.status(run.id,'a').receipt.id,message.id);const result=await task;assert.equal(result.ok,true);assert.equal(result.sessionId,'session_12345678');assert.equal(result.text,'Corrected result');assert.ok(record[1].args.includes('resume'));assert.ok(record[1].args.includes('session_12345678'));assert.match(record[1].input,/Use neutral backgrounds/);assert.ok(api.status(run.id,'a').events.some(x=>x.kind==='user'));assert.throws(()=>api.control(run.id,'a',{action:'pause'}),/не готов/);});
test('message during work interrupts and resumes without releasing the node result early',async t=>{const {engine,run,dir,config}=setup(t),api=new Sessions(engine),record=[],task=runJob({dir,config,model:'codex:test',prompt:'Task',kind:'execution'},fakeProcess(record));await until(()=>api.status(run.id,'a').sessionId);api.control(run.id,'a',{action:'message',text:'Correction'});assert.equal(fs.existsSync(path.join(dir,'result.json')),false);const result=await task;assert.equal(result.ok,true);assert.equal(record.length,2);assert.match(record[1].input,/Correction/);});
test('cancel while paused ends worker and keeps resumable session ID',async t=>{const {engine,run,dir,config}=setup(t),api=new Sessions(engine),task=runJob({dir,config,model:'codex:test',prompt:'Task',kind:'execution'},fakeProcess([]));await until(()=>api.status(run.id,'a').sessionId);api.control(run.id,'a',{action:'pause'});await until(()=>api.status(run.id,'a').status==='paused');fs.writeFileSync(path.join(dir,'cancel'),'stop');const result=await task;assert.equal(result.ok,false);assert.equal(result.sessionId,'session_12345678');assert.equal(api.status(run.id,'a').controlled,false);});
test('structured progress excludes hidden reasoning and preserves literal untrusted text',()=>{assert.deepEqual(publicEvent({type:'item.completed',item:{type:'reasoning',text:'private'}}),[]);assert.deepEqual(publicEvent({type:'assistant',message:{content:[{type:'thinking',thinking:'private'},{type:'text',text:'<script>hello</script>'}]}}).map(x=>x.text),['<script>hello</script>']);});
test('layouts persist separately from locked running graph; reject invalid trees and cross-project IDs',t=>{const {engine,p}=setup(t),store=new Workspaces(engine);const root={type:'leaf',id:'one',nodeId:'a'};const split=splitLeaf(root,'one','row',{type:'leaf',id:'two',nodeId:null});assert.equal(leaves(split).length,2);const saved=store.save(p.id,{name:'My workspace',tree:split});const next=new Workspaces(engine);assert.deepEqual(next.list(p.id)[0],saved);assert.deepEqual(removeLeaf(split,'one'),split.b);assert.throws(()=>validateLayout({name:'Bad',tree:{...split,ratio:NaN}}));assert.throws(()=>validateLayout({name:'Bad',tree:{...split,b:root}}));const other=engine.createProject('Other');assert.throws(()=>store.save(other.id,{...saved,name:'Cross-project'}));store.remove(p.id,saved.id);assert.equal(store.list(p.id).length,0);});
test('stale worker cannot accept input, input validation applies, resume retains sandbox policy',t=>{const {engine,run,dir}=setup(t),api=new Sessions(engine);writeJSON(path.join(dir,'live.json'),{accepting:true,status:'working',heartbeat:new Date(0).toISOString()});assert.equal(api.status(run.id,'a').controlled,false);assert.throws(()=>api.control(run.id,'a',{action:'message',text:'hello'}));assert.throws(()=>api.control(run.id,'a',{action:'message',text:'\x1bexit'}));const args=agentArgs({model:'codex:test',kind:'execution',dir},'session123');assert.ok(!args.includes('--sandbox'));assert.ok(args.includes('--approve-for-me'));assert.ok(args.indexOf('--approve-for-me')<args.indexOf('resume'));assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));});

test('Codex planner keeps read-only policy and executor uses automatic workspace review',()=>{
 for(const session of [undefined,'session123']){
  const planner=agentArgs({model:'codex:test',kind:'planner',dir:os.tmpdir()},session);
  assert.equal(planner[planner.indexOf('--sandbox')+1],'read-only');
  assert.ok(!planner.includes('--approve-for-me'));
  const executor=agentArgs({model:'codex:test',kind:'execution',dir:os.tmpdir()},session);
  assert.ok(executor.includes('--approve-for-me'));assert.ok(!executor.includes('--sandbox'));
 }
});
test('worker includes CLI stderr in failed result',async t=>{
 const {dir,config}=setup(t);
 const spawnProcess=()=>{const child=new EventEmitter();child.pid=123;child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new Writable({write(c,e,cb){cb();},final(cb){cb();setTimeout(()=>{child.stderr.write('error: incompatible CLI arguments');child.exitCode=2;child.emit('close',2);},10);}});return child;};
 const result=await runJob({dir,config,model:'codex:test',prompt:'Task',kind:'execution'},{spawnProcess});
 assert.equal(result.ok,false);assert.match(result.error,/incompatible CLI arguments/);
});
import {sessionFeed} from '../session-workspace.js';
test('terminal feed shows lifecycle, CLI diagnostics and item errors even without commands',()=>{
 const events=[{type:'start',model:'codex:test'},{type:'thread.started',thread_id:'s1'},{type:'item.completed',item:{type:'error',message:'Code Mode is unavailable'}},{type:'stderr',text:'EPERM rename live.json'},{type:'item.completed',item:{type:'agent_message',text:'Cannot execute tool'}}].flatMap(publicEvent);
 const feed=sessionFeed({events,status:'working',raw:true});assert.match(feed,/Code Mode is unavailable/);assert.match(feed,/EPERM/);assert.match(feed,/Cannot execute tool/);assert.match(feed,/Запущен процесс/);assert.doesNotMatch(feed,/Команд пока нет/);
 assert.match(sessionFeed({events:[],status:'failed',raw:true,error:'Worker crashed'}),/Worker crashed/);
 assert.equal(sessionFeed({terminal:{opened:true,ready:false,text:'CLI startup error'},raw:true}),'CLI startup error');
});
test('worker rejects missing code mode host even if model returns a final answer',async t=>{
 const {dir,config}=setup(t);const spawnProcess=()=>{const c=new EventEmitter();c.pid=123;c.exitCode=null;c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new Writable({write(x,e,cb){cb();},final(cb){cb();setTimeout(()=>{c.stdout.write(JSON.stringify({type:'item.completed',item:{type:'error',message:'Code Mode is unavailable: host executable was not found'}})+'\n');c.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Here is a proposal'}})+'\n');c.exitCode=0;c.emit('close',0);},10);}});return c;};
 const result=await runJob({dir,config,model:'codex:test',prompt:'Task',kind:'execution'},{spawnProcess});assert.equal(result.ok,false);assert.match(result.error,/Code Mode is unavailable/);
});
