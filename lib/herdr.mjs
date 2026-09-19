import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJSON, writeJSON} from './storage.mjs';
const exec = promisify(execFile);
const worker = fileURLToPath(new URL('../worker.mjs', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
export class Herdr {
  constructor(config) { this.config = config; this.workspace = null; }
  async command(...args) {
    const {stdout} = await exec(this.config.herdrPath, [...(this.config.herdrSession ? ['--session',this.config.herdrSession] : []),...args], {timeout:15000, windowsHide:true, maxBuffer:4*1024*1024});
    // Mutating pane commands succeed with an empty stdout in Herdr 0.9.1.
    if (!stdout.trim()) return null;
    if(args[0]==='pane'&&args[1]==='read'){try{const value=JSON.parse(stdout);return value.result??{text:stdout};}catch{return {text:stdout};}}
    const response = JSON.parse(stdout);
    if (response.error) throw new Error(response.error.message);
    return response.result;
  }
  async health() { try { await this.command('workspace','list'); return {ok:true}; } catch(e) { return {ok:false, error:e.message.slice(0,500)}; } }
  async ensureWorkspace(cwd) {
    if (!this.workspacePromise) this.workspacePromise = (async () => {
      const list = await this.command('workspace','list');
      const found = list.workspaces.find(w => w.label === 'Graph Studio');
      this.workspace = found?.workspace_id || (await this.command('workspace','create','--cwd',cwd,'--label','Graph Studio','--no-focus')).workspace.workspace_id;
      return this.workspace;
    })().catch(e => { this.workspacePromise = null; throw e; });
    return this.workspacePromise;
  }
  async execute(job, onStart) {
    fs.mkdirSync(job.dir, {recursive:true});
    fs.mkdirSync(path.join(job.dir,'work'), {recursive:true});
    writeJSON(path.join(job.dir,'job.json'), {...job, config:this.config});
    const workspace = await this.ensureWorkspace(job.dir);
    const tab = await this.command('tab','create','--workspace',workspace,'--cwd',job.workingDirectory || path.join(job.dir,'work'),'--label',job.title.slice(0,45),'--no-focus');
    const pane = tab.root_pane.pane_id;
    onStart?.({pane, tab:tab.tab.tab_id, workspace});
    const quote = s => "'" + s.replaceAll("'", "''") + "'";
    const command = `& ${quote(process.execPath)} ${quote(worker)} ${quote(path.join(job.dir,'job.json'))}`;
    const encoded = Buffer.from(command,'utf16le').toString('base64');
    await this.command('pane','run',pane,`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`);
    let deadline = Date.now() + this.config.timeoutMs + 20000;
    while (Date.now() < deadline) {
      const result = readJSON(path.join(job.dir,'result.json'));
      if (result) return result;
      const live=readJSON(path.join(job.dir,'live.json'));
      if(live?.accepting&&Date.now()-Date.parse(live.heartbeat)<15000)deadline=Date.now()+20000;
      await sleep(700);
    }
    fs.writeFileSync(path.join(job.dir,'cancel'), 'timeout');
    const live=readJSON(path.join(job.dir,'live.json'));
    let detail='';try{const output=await this.command('pane','read',pane,'--source','visible','--format','text');detail=String(output?.text??output?.output?.text??'').slice(-4000);}catch{}
    throw new Error((live?.heartbeat?'Процесс Graph перестал обновлять heartbeat ('+live.heartbeat+').':'Истекло время ожидания процесса.')+(detail?'\n'+detail:' Откройте журнал узла.'));
  }
}
