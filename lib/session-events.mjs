import fs from 'node:fs';

// Only public messages/tool events are presented. Never expose reasoning blocks.
export function publicEvent(e) {
  const time=e.time||'', result=[];
  const add=(kind,text)=>{if(typeof text==='string'&&text.trim())result.push({time,kind,text:text.slice(0,12000)});};
  if(e.type==='graph.message')add('user',e.text);
  if(e.type==='graph.control')add('status',e.message);
  if(e.type==='start')add('status','Запущен процесс '+e.model);
  if(e.type==='thread.started')add('status','Сессия подключена: '+e.thread_id);
  if(e.type==='turn.started')add('status','Агент начал работу.');
  if(e.type==='turn.completed')add('status','Агент завершил ответ.');
  if(e.type==='turn.failed')add('error',e.error?.message||'Ошибка выполнения агента.');
  if(e.type==='stderr')add('diagnostic',e.text);
  if(e.type==='stdout')add('output',e.text);
  if(e.type==='failure'||e.type==='error')add('error',e.message||e.error?.message);
  if(e.type==='assistant')for(const c of e.message?.content||[]){if(c.type==='text')add('message',c.text);if(c.type==='tool_use')add('tool',c.name+(c.input?.command?' · '+c.input.command:c.input?.file_path?' · '+c.input.file_path:''));}
  if(['item.started','item.completed','item.updated'].includes(e.type)){
    const item=e.item||{};
    if(item.type==='error')add('error',item.message);
    if(item.type==='agent_message')add('message',item.text);
    if(item.type==='command_execution'){add('tool',item.command);if(e.type==='item.completed')add('output',item.aggregated_output);}
    if(item.type==='file_change')add('tool',(item.changes||[]).map(c=>c.kind+' '+c.path).join('\n'));
    if(item.type==='mcp_tool_call')add('tool',[item.server,item.tool].filter(Boolean).join(' / '));
  }
  if(e.type==='result'&&e.result)add(e.is_error?'error':'message',e.result);
  return result;
}
export function readEvents(file,limit=120000) {
  if(!fs.existsSync(file))return [];
  const fd=fs.openSync(file,'r');let text;
  try{const size=fs.fstatSync(fd).size,start=Math.max(0,size-limit),buffer=Buffer.alloc(size-start);fs.readSync(fd,buffer,0,buffer.length,start);text=buffer.toString('utf8');if(start)text=text.slice(text.indexOf('\n')+1);}finally{fs.closeSync(fd);}
  return text.split('\n').flatMap(line=>{try{return publicEvent(JSON.parse(line));}catch{return [];}}).slice(-100);
}
