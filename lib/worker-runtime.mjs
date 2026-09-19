import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {readJSON,writeJSON} from './storage.mjs';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
const exec=promisify(execFile);

export async function githubEnvironment(job,env,{command=exec}={}){
  if(!job.githubRepository||job.kind==='planner'||job.config.githubAgentAuth!==true)return env;
  try{const {stdout}=await command(job.config.ghPath||'gh',['auth','token','--hostname','github.com'],{windowsHide:true,timeout:15000,maxBuffer:16000});const token=stdout.trim();if(!token)throw Error();return {...env,GH_TOKEN:token,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1'};}
  catch{throw new Error('Авторизация GitHub недоступна процессу Graph. Выполните gh auth login в аккаунте, запускающем Graph.');}
}

export function agentArgs(job,sessionId){
  const [provider,model]=job.model.split(':'),planner=job.kind==='planner';
  if(provider==='claude')return ['-p','--model',model,'--effort','low','--system-prompt','Ты агент Graph. Выполняй только явно порученный этап. Не делегируй работу. Пиши по-русски. Кратко сообщай о действиях и результатах, не раскрывай скрытые рассуждения.','--output-format','stream-json','--verbose','--tools',planner?'Read,Glob,Grep':'default','--permission-mode',planner?'plan':'auto','--permission-prompts','none','--disable-slash-commands',...(sessionId?['--resume',sessionId]:[])];
  if(provider!=='codex')throw new Error('Провайдер не поддерживается.');
  return ['exec',...(planner?['--sandbox','read-only']:['--approve-for-me']),...(!planner&&job.githubRepository?['-c','sandbox_workspace_write.network_access=true']:[]),...(sessionId?['resume',sessionId]:[]),'--skip-git-repo-check','--json',...(model==='default'?[]:['--model',model]),'-c','model_reasoning_effort="low"','--output-last-message',path.join(job.dir,'output.md'),'-'];
}
function killTree(child){return new Promise((resolve,reject)=>{if(!child||child.exitCode!==null)return resolve();if(process.platform==='win32')execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},err=>err&&child.exitCode===null?reject(err):resolve());else{child.kill('SIGTERM');resolve();}});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function runJob(job,{spawnProcess=spawn,stopProcess=killTree}={}){
  const {dir,config}=job,[provider]=job.model.split(':'),output=path.join(dir,'output.md'),inbox=path.join(dir,'inbox');
  fs.mkdirSync(inbox,{recursive:true});fs.mkdirSync(path.join(dir,'work'),{recursive:true});
  let sessionId,receipt=null,usage,paused=false,nextPrompt=job.prompt+'\n\nВо время работы давай короткие публичные сводки действий и находок. Не раскрывай скрытые рассуждения. Соблюдай требуемый формат итогового ответа.',finalText='',fatal='',cancelled=false;
  let githubToken='';
  const redact=text=>githubToken?text.replaceAll(githubToken,'[REDACTED]'):text;
  const event=data=>fs.appendFileSync(path.join(dir,'events.jsonl'),redact(JSON.stringify({time:new Date().toISOString(),...data}))+'\n');
  let live={status:'starting',accepting:true},attempt=0,environment=null;
  const publish=(patch={})=>{live={...live,...patch,sessionId,receipt,heartbeat:new Date().toISOString()};writeJSON(path.join(dir,'live.json'),live);};
  const commands=()=>fs.readdirSync(inbox).filter(f=>f.endsWith('.json')).sort().map(f=>{const command=readJSON(path.join(inbox,f));fs.unlinkSync(path.join(inbox,f));return command;});
  const apply=items=>{for(const c of items){if(c.action==='pause'){paused=true;receipt={id:c.id,status:'paused'};event({type:'graph.control',message:'Остановка подтверждена.'});}else if(c.action==='message'){paused=false;nextPrompt=(nextPrompt?nextPrompt+'\n\n':'')+'Уточнение пользователя:\n'+c.text;receipt={id:c.id,status:'received'};event({type:'graph.message',text:c.text});}}};
  let heartbeatError='';
  const heartbeat=setInterval(()=>{try{publish();heartbeatError='';}catch(e){if(heartbeatError!==e.message){heartbeatError=e.message;const message='Не удалось сохранить heartbeat: '+e.message;try{event({type:'error',message});}catch{process.stderr.write(message+'\n');}}}},1000);
  try{
    publish();
    while(true){
      if(fs.existsSync(path.join(dir,'cancel'))){cancelled=true;throw new Error('Выполнение остановлено.');}
      if(paused){apply(commands());publish({status:paused?'paused':'starting'});if(paused){await sleep(100);continue;}}
      const text=nextPrompt;nextPrompt='';finalText='';let failure='',stderrTail='',pending='',interrupted=false,code,stopPromise=null,stopError=null;
      attempt++;fs.mkdirSync(path.join(dir,'prompts'),{recursive:true});
      fs.writeFileSync(path.join(dir,'prompts',String(attempt)+'.md'),text);
      writeJSON(path.join(dir,'prompt-attempt.json'),{attempt,chars:text.length,sha256:createHash('sha256').update(text).digest('hex'),requestedModel:job.model});
      if(fs.existsSync(output))fs.unlinkSync(output);
      let env={...process.env};delete env.CLAUDECODE;const toolPaths=['nodePath','gitPath','ghPath'].map(key=>config[key]).filter(Boolean).map(file=>path.dirname(file));if(toolPaths.length){const currentPath=env.PATH||env.Path||'';delete env.Path;env.PATH=[...toolPaths,currentPath].join(path.delimiter);}
      env=await githubEnvironment(job,env);githubToken=env.GH_TOKEN||'';
      const child=spawnProcess(provider==='claude'?config.claudePath:config.codexPath,agentArgs(job,sessionId),{cwd:job.workingDirectory||path.join(dir,'work'),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
      writeJSON(path.join(dir,'process.json'),{pid:child.pid,worker:process.pid,startedAt:new Date().toISOString()});
      event({type:'start',provider,model:job.model});publish({status:'working',accepting:true});
      function consume(line){if(!line.trim())return;try{const data=JSON.parse(line);event(data);if(data.type==='system'&&data.subtype==='init'){environment={attempt,provider,requestedModel:job.model,resolvedModel:data.model||null,cliVersion:data.claude_code_version||null,tools:data.tools||[],mcpServers:(data.mcp_servers||[]).map(m=>({name:m.name,status:m.status}))};writeJSON(path.join(dir,'environment.json'),environment);writeJSON(path.join(dir,'prompts',String(attempt)+'.environment.json'),environment);}const id=data.session_id||(data.type==='thread.started'?data.thread_id:null);if(id&&!sessionId){sessionId=id;publish();}if(data.type==='result'){finalText=data.result||'';usage=data.usage;if(data.is_error)failure=data.result||JSON.stringify(data.errors||data);}if(data.type==='item.completed'&&data.item?.type==='error'&&/Code Mode is unavailable|failed to spawn code-mode host/i.test(data.item.message||''))failure=data.item.message;if(data.type==='turn.failed'||data.type==='error')failure=data.error?.message||data.message||'Ошибка агента';if(data.type==='turn.completed')usage=data.usage;if(data.type==='item.completed'&&data.item?.type==='agent_message')finalText=data.item.text;}catch{event({type:'stdout',text:line});}}
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',chunk=>{pending+=chunk;let i;while((i=pending.indexOf('\n'))>=0){consume(pending.slice(0,i));pending=pending.slice(i+1);}});
      child.stderr.on('data',chunk=>{stderrTail=(stderrTail+String(chunk)).slice(-4000);event({type:'stderr',text:String(chunk)});});
      child.stdin.on('error',()=>{});
      child.stdin.end(text,error=>{if(error){failure='Не удалось передать сообщение процессу: '+error.message;return;}if(receipt?.status==='received'){receipt={...receipt,status:'delivered'};publish();event({type:'graph.control',message:'Уточнение передано процессу агента.'});}});
      const started=Date.now(),queue=[];
      const requestStop=()=>{if(!stopPromise){publish({status:'stopping'});stopPromise=Promise.resolve(stopProcess(child)).catch(e=>{stopError=e;publish({status:'stop_failed'});});}};
      const timer=setInterval(()=>{
        try{const incoming=commands();if(incoming.length){queue.push(...incoming);interrupted=true;requestStop();}
          if(fs.existsSync(path.join(dir,'cancel'))||Date.now()-started>(config.timeoutMs||600000)){cancelled=true;failure='Выполнение остановлено или превышен лимит времени.';requestStop();}
        }catch(e){failure=e.message;requestStop();}
      },100);
      try{code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearInterval(timer);}
      if(stopPromise)await stopPromise;if(stopError)throw stopError;consume(pending);
      queue.push(...commands());if(queue.length)interrupted=true;
      if(cancelled)throw new Error(failure||'Выполнение остановлено.');
      if(interrupted){
        if(!sessionId)nextPrompt=job.prompt;
        apply(queue);publish({status:paused?'paused':'starting'});continue;
      }
      if(provider==='codex'&&fs.existsSync(output))finalText=fs.readFileSync(output,'utf8');
      finalText=redact(finalText);
      if(code!==0||failure||!finalText.trim())throw new Error(failure||`Агент завершился с кодом ${code}, без результата.${stderrTail.trim()?'\n'+stderrTail.trim():''}`);
      fs.writeFileSync(output,finalText);break;
    }
  }catch(e){fatal=redact(e.message);finalText=redact(finalText);event({type:'failure',message:fatal});}
  finally{clearInterval(heartbeat);publish({status:cancelled?'cancelled':fatal?'failed':'done',accepting:false});}
  const result={ok:!fatal,...(fatal?{error:fatal,...(finalText?{text:finalText}:{})}:{text:finalText}),sessionId,usage,environment,finishedAt:new Date().toISOString()};
  writeJSON(path.join(dir,'result.json'),result);return result;
}
