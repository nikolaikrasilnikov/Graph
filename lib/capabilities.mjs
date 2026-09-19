import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function inspectCapabilities(config,project,{run=exec}={}){
  const checks=[];const cwd=project.workingDirectory||undefined;
  const probe=async(id,file,args)=>{try{await run(file,args,{cwd,windowsHide:true,timeout:15000,maxBuffer:100000,env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0'}});checks.push({id,ok:true});return true;}catch(e){checks.push({id,ok:false,message:e.code==='ENOENT'?'Программа не найдена.':'Проверка не пройдена (код '+(e.code??'unknown')+').'});return false;}};
  checks.push({id:'workspace',ok:!!cwd,message:cwd||'Выберите папку исходников проекта; библиотека не заменяет рабочую папку.'});
  checks.push({id:'codex-runtime',ok:!!config.codexPath&&fs.existsSync(config.codexPath)&&fs.existsSync(path.join(path.dirname(config.codexPath),'codex-code-mode-host.exe'))});
  await probe('git',config.gitPath||'git',['--version']);
  if(cwd)await probe('git-repository',config.gitPath||'git',['rev-parse','--show-toplevel']);
  const gh=await probe('github-cli',config.ghPath||'gh',['--version']);
  if(gh)await probe('github-auth',config.ghPath||'gh',['auth','status','--hostname','github.com']);
  checks.push({id:'github-target',ok:!!project.githubRepository,message:project.githubRepository||'Укажите owner/repository в настройках проекта.'});
  checks.push({id:'github-agent-auth',ok:config.githubAgentAuth===true,message:config.githubAgentAuth===true?'Разрешена передача авторизации исполнителям.':'Передача авторизации агентам ещё не включена.'});
  if(gh&&project.githubRepository)await probe('github-access',config.ghPath||'gh',['repo','view',project.githubRepository,'--json','nameWithOwner']);
  const required=['workspace','git','git-repository','github-cli','github-auth','github-target','github-access','github-agent-auth'];
  return {checks,githubReady:required.every(id=>checks.some(c=>c.id===id&&c.ok)),note:'Проверка чтения и локальной конфигурации; право записи, правила ветки и публикация проверяются при выполнении конкретной операции.'};
}
