import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {agentArgs} from '../lib/worker-runtime.mjs';
import {inspectCapabilities} from '../lib/capabilities.mjs';
import {resumeCommand} from '../lib/terminals.mjs';

test('portable default model preserves CLI account configuration on new and resumed jobs',()=>{
 const job={model:'codex:default',kind:'execution',dir:os.tmpdir()};
 for(const session of [undefined,'session123']){const args=agentArgs(job,session);assert.ok(!args.includes('--model'));assert.ok(args.includes('--approve-for-me'));}
 const args=agentArgs({...job,model:'codex:chosen-model'});assert.equal(args[args.indexOf('--model')+1],'chosen-model');
});
test('GitHub readiness uses configured portable Git even if absent from PATH',async()=>{
 const calls=[];await inspectCapabilities({gitPath:'portable-git',ghPath:'portable-gh'},{workingDirectory:os.tmpdir()},{run:async(file,args)=>{calls.push({file,args});return {stdout:''};}});
 const gitCalls=calls.filter(c=>c.args[0]==='rev-parse'||c.file==='portable-git');assert.equal(gitCalls.length,2);assert.ok(gitCalls.every(c=>c.file==='portable-git'));
});
test('interactive resume includes all configured tool directories without embedding credentials',()=>{
 const cmd=resumeCommand({nodePath:'/portable/node/node.exe',gitPath:'/portable/git/git.exe',ghPath:'/portable/gh/gh.exe',codexPath:'/portable/codex/codex.exe'},{model:'codex:default'},{sessionId:'session123'});
 const script=Buffer.from(cmd.split(' ').at(-1),'base64').toString('utf16le');for(const folder of ['/portable/node','/portable/git','/portable/gh'])assert.ok(script.includes(folder));assert.ok(!script.includes('GH_TOKEN'));
});
