import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const textPattern=/\.(md|txt|json|jsonl|csv|log|ya?ml|py|cs|js|mjs|html|css|toml|xml|xaml|sh|ps1)$/i;
export function readJSON(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
export function writeJSON(file, data, {rename=fs.renameSync,wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp';
  try{
    fs.writeFileSync(tmp,JSON.stringify(data,null,2),{flag:'wx'});
    for(let attempt=0;;attempt++){
      try{rename(tmp,file);break;}
      catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=6)throw e;wait(10*2**attempt);}
    }
  }finally{try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
export function safePath(root, relative = '') {
  if (typeof relative !== 'string' || relative.includes('\0')) throw new Error('Некорректный путь.');
  const base = path.resolve(root), target = path.resolve(base, relative);
  const inside = p => p === base || p.startsWith(base + path.sep);
  if (!inside(target)) throw new Error('Путь находится за пределами библиотеки.');
  if (fs.existsSync(base)) {
    let ancestor=target;while(!fs.existsSync(ancestor)&&ancestor!==base)ancestor=path.dirname(ancestor);
    const realBase = fs.realpathSync(base), real = fs.realpathSync(ancestor);
    if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new Error('Ссылка ведёт за пределы библиотеки.');
  }
  return target;
}
export function listFiles(root, relative = '') {
  const target = safePath(root, relative);
  return fs.readdirSync(target, {withFileTypes:true}).filter(e => !e.name.startsWith('.') && !e.isSymbolicLink()).map(e => ({name:e.name, path:path.join(relative, e.name).replaceAll('\\','/'), directory:e.isDirectory()})).sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
}
export function textFile(root, relative) {
  const file = safePath(root, relative);
  if (!textPattern.test(file)) throw new Error('Просмотр поддерживает текстовые файлы.');
  if (fs.statSync(file).size > 500000) throw new Error('Файл больше 500 КБ. Выберите меньший файл.');
  return fs.readFileSync(file, 'utf8');
}
