import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readJSON,writeJSON} from './storage.mjs';
import {readEvents} from './session-events.mjs';

export class Sessions {
  constructor(engine){this.engine=engine;}
  target(runId,nodeId){const run=this.engine.run(runId),node=run.graph.nodes.find(n=>n.id===nodeId);if(!node||!run.states[nodeId])throw new Error('Узел не найден.');return {run,node,state:run.states[nodeId],dir:this.engine.file('runs',runId,nodeId)};}
  status(runId,nodeId){const {state,dir}=this.target(runId,nodeId);const live=readJSON(path.join(dir,'live.json'));const source=state.reusedFrom?this.engine.file('runs',state.reusedFrom,nodeId):dir;
    const events=readEvents(path.join(source,'events.jsonl'));
    const controlled=state.status==='running'&&live?.accepting===true&&Date.now()-Date.parse(live.heartbeat)<15000;
    return {status:controlled?live.status:state.status,controlled,sessionId:live?.sessionId||state.sessionId,events,latest:events.filter(e=>['message','tool','status','error'].includes(e.kind)).at(-1),receipt:live?.receipt||null,error:state.error||null};
  }
  control(runId,nodeId,input){const {dir}=this.target(runId,nodeId);if(!['pause','message'].includes(input.action))throw new Error('Неизвестное действие.');if(input.action==='message'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>16000||/[\x00-\x08\x0b-\x1f\x7f]/.test(input.text)))throw new Error('Введите 1–16000 символов без управляющих кодов.');if(!this.status(runId,nodeId).controlled)throw new Error('Этап не готов к управлению. Обновите сессию.');
    const id=randomUUID(),command={id,action:input.action,text:input.action==='message'?input.text.trim():undefined,time:new Date().toISOString()};
    const file=path.join(dir,'inbox',Date.now()+'-'+id+'.json');writeJSON(file,command);
    // The worker can finish between the initial check and the atomic enqueue.
    // Reject an unconsumed message in that boundary rather than claim delivery.
    const latest=readJSON(path.join(dir,'live.json'));
    if(!latest?.accepting&&fs.existsSync(file)){fs.unlinkSync(file);throw new Error('Этап уже завершился. Откройте диалог, чтобы отправить уточнение.');}
    return {id,status:'queued'};
  }
}
