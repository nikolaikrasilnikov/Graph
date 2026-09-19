import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const files=execFileSync(process.env.GRAPH_GIT||'git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=/^(?:config\.json(?:\.|$)|\.env(?:\.|$)|\.runtime\/|\.downloads\/|\.graph-data\/|library\/|\.scratch\/|reports\/|research\/|artifacts\/|node_modules\/)/;
const patterns=[['personal home path',/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+/i],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['GitHub credential',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],['API credential',/\bsk-(?:proj-)?[A-Za-z0-9_-]{35,}\b/]];
const failures=[];
for(const file of files){if(forbidden.test(file)||/\.(?:log|jsonl|pem|key)$/i.test(file))failures.push({file,reason:'local data file'});const text=fs.readFileSync(file).toString('utf8');for(const [reason,pattern] of patterns)if(pattern.test(text))failures.push({file,reason});}
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}else console.log(`Release source scan passed: ${files.length} tracked files; no configured private-path, credential or local-data patterns. Manual review is still required.`);
