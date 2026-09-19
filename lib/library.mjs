import fs from 'node:fs';
import path from 'node:path';
import {safePath,textFile,textPattern} from './storage.mjs';
export {textPattern} from './storage.mjs';
const excluded=new Set(['node_modules','vendor','dist','build','$RECYCLE.BIN','System Volume Information']);
export function resolveReference(config,ref){if(typeof ref!=='string'||ref.includes('\0'))throw new Error('Некорректный путь.');if(ref.startsWith('fs:')){const value=ref.slice(3);if(!path.isAbsolute(value))throw new Error('Нужен абсолютный путь.');return path.resolve(value);}return safePath(config.libraryRoot,ref);}
export function fileReference(file){return 'fs:'+path.resolve(file).replaceAll('\\','/');}
export function browse(config,ref){if(ref==='computer')return {path:'computer',parent:null,files:(process.platform==='win32'?'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(d=>d+':\\').filter(p=>fs.existsSync(p)):['/']).map(p=>({name:p,path:fileReference(p),directory:true}))};const target=resolveReference(config,ref||fileReference(config.libraryRoot));const root=path.parse(target).root;return {path:fileReference(target),parent:target===root?'computer':fileReference(path.dirname(target)),files:fs.readdirSync(target,{withFileTypes:true}).filter(e=>!e.isSymbolicLink()).map(e=>({name:e.name,path:fileReference(path.join(target,e.name)),directory:e.isDirectory(),hidden:e.name.startsWith('.')})).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name))};}
export function referenceText(config,ref){const target=resolveReference(config,ref);return textFile(path.dirname(target),path.basename(target));}
export function expandReferences(config,refs,{limit=160}={}){const result=[],seen=new Set();let visited=0;function visit(file,explicit=false){if(++visited>6000)throw new Error('Папка слишком большая. Выберите вложенную папку.');const stat=fs.lstatSync(file);if(stat.isSymbolicLink()){if(explicit)throw new Error('Вложите исходный файл, а не символическую ссылку.');return;}if(stat.isDirectory()){for(const e of fs.readdirSync(file,{withFileTypes:true})){if(e.name.startsWith('.')||excluded.has(e.name)||e.isSymbolicLink())continue;visit(path.join(file,e.name));}}else if(stat.isFile()&&textPattern.test(file)){const real=fs.realpathSync(file);if(seen.has(real))return;seen.add(real);if(result.length>=limit)throw new Error(`Слишком много файлов (больше ${limit}). Выберите меньшую папку.`);result.push(fileReference(file));}else if(explicit)throw new Error('Неподдерживаемый формат контекста: '+path.basename(file));}for(const ref of refs)visit(resolveReference(config,ref),true);return result;}
export function referenceContext(config,refs){let total=0;return expandReferences(config,refs).map(ref=>{const text=referenceText(config,ref);total+=text.length;if(total>48000)throw new Error('В контексте больше 48 000 символов. Подключите папку к планировщику для выборочного распределения или выберите меньшую папку.');return `\n<reference path=${JSON.stringify(ref)}>\n${text}\n</reference>`;}).join('\n');}
// Read only the string description field; never execute or deserialize arbitrary YAML tags.
export function skillDescription(text){
  const header=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if(!header)return '';
  const lines=header.split(/\r?\n/),index=lines.findIndex(l=>/^description\s*:/.test(l));
  if(index<0)return '';
  let value=lines[index].replace(/^description\s*:\s*/,'');
  if(/^[>|][-+]?\s*$/.test(value)){
    const parts=[];for(let i=index+1;i<lines.length&&(/^[ \t]/.test(lines[i])||!lines[i].trim());i++)parts.push(lines[i].trim());
    value=parts.join(' ');
  }else if(value.startsWith('"')){try{value=JSON.parse(value);}catch{value=value.replace(/^"|"$/g,'');}}
  else if(value.startsWith("'"))value=value.replace(/^'|'$/g,'').replaceAll("''","'");
  return value.trim();
}
export function libraryCatalog(config,roots){
  const candidates=[],files=[],warnings=[],directories=[],seen=new Set();let visited=0,limited=false;
  const deferred=new Set(['projects','work','logs','reports','sessions','memory','recipes']);
  const searchRoots=[];
  function walk(file,depth=0){
    if(visited++>=4000||depth>12){limited=true;return;}
    const stat=fs.lstatSync(file);if(stat.isSymbolicLink())return;
    const real=fs.realpathSync(file);if(seen.has(real))return;seen.add(real);
    if(config.dataRoot&&(real===path.resolve(config.dataRoot)||real.startsWith(path.resolve(config.dataRoot)+path.sep)))return;
    if(stat.isDirectory()){
      const skill=path.join(file,'SKILL.md');
      if(fs.existsSync(skill)&&!fs.lstatSync(skill).isSymbolicLink()){
        walk(skill,depth+1);directories.push({path:fileReference(file),purpose:'Ресурсы навыка: читать по необходимости'});return;
      }
      if(depth>0&&deferred.has(path.basename(file))){directories.push({path:fileReference(file),purpose:'Данные: искать только для текущей задачи'});return;}
      for(const e of fs.readdirSync(file,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        if(e.name.startsWith('.')||excluded.has(e.name)||e.isSymbolicLink())continue;
        try{walk(path.join(file,e.name),depth+1);}catch{warnings.push('Недоступен: '+fileReference(path.join(file,e.name)));}
      }
    }else if(textPattern.test(file)&&stat.size<=500000){
      const body=fs.readFileSync(file,'utf8'),skill=path.basename(file).toLowerCase()==='skill.md';
      candidates.push({path:fileReference(file),kind:skill?'skill':'reference',description:skill?(skillDescription(body)||body.slice(0,180)):body.slice(0,180).replace(/\s+/g,' ')});
    }
  }
  for(const ref of roots){try{const file=resolveReference(config,ref);searchRoots.push(fileReference(fs.realpathSync(file)));walk(file);}catch(e){warnings.push(ref+': '+e.message);}}
  candidates.sort((a,b)=>Number(b.kind==='skill')-Number(a.kind==='skill')||a.path.localeCompare(b.path));
  let chars=0;for(const entry of candidates){const size=JSON.stringify(entry).length;if(files.length>=240||chars+size>42000){limited=true;continue;}files.push(entry);chars+=size;}
  if(limited)warnings.push('Каталог ограничен 240 записями / 42 000 символами записей. Остальное ищите в searchRoots.');
  return {files,searchRoots:[...new Set(searchRoots)],directories:directories.slice(0,60),warnings};
}
export function catalogAllowsReference(config,catalog,ref){
  try{
    const file=fs.realpathSync(resolveReference(config,ref));
    if(!fs.statSync(file).isFile()||!textPattern.test(file))return false;
    if(config.dataRoot&&(file===path.resolve(config.dataRoot)||file.startsWith(path.resolve(config.dataRoot)+path.sep)))return false;
    return (catalog.searchRoots||catalog.files.map(f=>f.path)).some(root=>{
      const base=fs.realpathSync(resolveReference(config,root));
      return file===base||(fs.statSync(base).isDirectory()&&file.startsWith(base+path.sep));
    });
  }catch{return false;}
}
