export const outcomeInstruction='В конце итогового ответа добавь одну строку <!-- graph-outcome: {"status":"completed|partial|blocked","summary":"фактический итог"} --> с одним выбранным status. completed — порученное действие выполнено; partial — выполнена только часть; blocked — действие не выполнено из-за препятствия. Подготовленный план вместо требуемых изменений или неопубликованный требуемый релиз не являются completed. В основном тексте явно укажи результат, причину отказа, созданные файлы и ссылки на внешние результаты. Не включай секреты.';
export function parseOutcome(text=''){
  const match=text.match(/<!--\s*graph-outcome:\s*(\{[^\n]*\})\s*-->\s*$/);
  if(!match)return {text,outcome:{status:'unreported',summary:'Агент не сообщил статус выполнения задачи.'}};
  try{const value=JSON.parse(match[1]);if(!['completed','partial','blocked'].includes(value.status)||typeof value.summary!=='string'||!value.summary.trim())throw Error();return {text:text.slice(0,match.index).trim(),outcome:{status:value.status,summary:value.summary.slice(0,2000)}};}
  catch{return {text,outcome:{status:'unreported',summary:'Некорректный статус выполнения задачи.'}};}
}
export function executionResult(r){
  if(r.kind!=='execution')return '';
  const sinks=r.graph.nodes.filter(n=>!r.graph.nodes.some(x=>x.dependsOn.includes(n.id)));
  const problems=r.graph.nodes.filter(n=>['failed','blocked','cancelled','interrupted'].includes(r.states[n.id]?.status));
  const statusText={blocked:'не готова зависимость',failed:'ошибка',cancelled:'остановлен пользователем',interrupted:'выполнение прервано'};
  const sections=sinks.map(n=>{const s=r.states[n.id]||{};return '# '+n.title+'\n\n'+(s.outcome?.summary?s.outcome.summary+'\n\n':'')+(s.result||s.error||'Этап не выполнен: '+(statusText[s.status]||s.status));});
  if(problems.length)sections.push('## Препятствия\n\n'+problems.map(n=>{const s=r.states[n.id];return '### '+n.title+'\n\n'+(s.error||'Не выполнен: '+(statusText[s.status]||s.status))+(s.result&&!sinks.some(x=>x.id===n.id)?'\n\n'+s.result:'');}).join('\n\n'));
  if(problems.length){const earlier=r.graph.nodes.filter(n=>r.states[n.id]?.status==='done'&&r.states[n.id]?.result&&!sinks.some(x=>x.id===n.id));if(earlier.length)sections.push('## Полученные ответы\n\n'+earlier.map(n=>'### '+n.title+'\n\n'+r.states[n.id].result).join('\n\n'));}
  if(r.error)sections.push('## Ошибка запуска\n\n'+r.error);
  return sections.join('\n\n---\n\n');
}
