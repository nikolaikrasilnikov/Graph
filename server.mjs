import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJSON, listFiles, textFile, safePath} from './lib/storage.mjs';
import {Herdr} from './lib/herdr.mjs';
import {Engine} from './lib/engine.mjs';
import {browse,referenceText,expandReferences,libraryCatalog,fileReference,resolveReference} from './lib/library.mjs';
import {Terminals} from './lib/terminals.mjs';
import {Sessions} from './lib/sessions.mjs';
import {Workspaces} from './lib/workspaces.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const config=readJSON(process.env.GRAPH_CONFIG_FILE||path.join(root,'config.json'));
if(!config)throw new Error('Run Setup.cmd first: config.json is missing.');
if(process.env.GRAPH_DATA_ROOT)config.dataRoot=process.env.GRAPH_DATA_ROOT;
if(process.env.GRAPH_PORT)config.port=Number(process.env.GRAPH_PORT);
const adapter=new Herdr(config), engine=new Engine(config,adapter);engine.recover();const terminals=new Terminals(engine,adapter);
const sessions=new Sessions(engine),workspaces=new Workspaces(engine);
if(!engine.projects().length)engine.createProject('Мой первый проект');
function send(res,status,data,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type.startsWith('application/json')?JSON.stringify(data):data);}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>300000)throw new Error('Слишком большой запрос.');}return JSON.parse(raw||'{}');}
const server=http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host;if(![`127.0.0.1:${config.port}`,`localhost:${config.port}`].includes(host))return send(res,403,{error:'Недопустимый host.'});
    if(req.headers.origin&&!['http://'+host].includes(req.headers.origin))return send(res,403,{error:'Недопустимый origin.'});
    const url=new URL(req.url,'http://'+host), route=url.pathname;
    if(req.method!=='GET'&&(req.headers['x-graph-client']!=='studio'||!req.headers['content-type']?.startsWith('application/json')))return send(res,403,{error:'Нужен локальный клиент Graph.'});
    if(route==='/api/health'){const health=await adapter.health();return send(res,200,{installationRoot:root,version:readJSON(path.join(root,'package.json')).version,herdr:health,providers:{claude:fs.existsSync(config.claudePath),codex:fs.existsSync(config.codexPath)},models:config.models,defaultModel:config.defaultModel,dataRoot:config.dataRoot,libraryRoot:config.libraryRoot,concurrency:config.concurrency});}
    if(route==='/api/projects')return send(res,200,req.method==='POST'?engine.createProject((await body(req)).title):engine.projects());
    if(route==='/api/runs'&&req.method==='GET')return send(res,200,engine.runs(url.searchParams.get('project')).map(({states,graph,context,nodeContexts,catalog,result,...r})=>({...r,nodeCount:graph.nodes.length,doneCount:Object.values(states).filter(s=>s.status==='done').length})));
    if(route==='/api/library'&&req.method==='GET')return send(res,200,listFiles(config.libraryRoot,url.searchParams.get('path')||''));
    if(route==='/api/file'&&req.method==='GET')return send(res,200,{text:textFile(config.libraryRoot,url.searchParams.get('path'))});
    if(route==='/api/fs'&&req.method==='GET')return send(res,200,browse(config,url.searchParams.get('path')));
    if(route==='/api/reference'&&req.method==='GET')return send(res,200,{text:referenceText(config,url.searchParams.get('path'))});
    if(route==='/api/context/inspect'&&req.method==='POST'){const {path:ref,catalog}=await body(req);const target=resolveReference(config,ref);return send(res,200,{directory:fs.statSync(target).isDirectory(),files:catalog?[]:expandReferences(config,[ref])});}
    if(route==='/api/catalog'&&req.method==='POST'){const {roots}=await body(req);if(!Array.isArray(roots)||roots.length>8)throw new Error('Подключите до 8 папок.');return send(res,200,libraryCatalog(config,roots));}
    const workspaceRoute=route.match(/^\/api\/projects\/([\w-]+)\/workspaces(?:\/([\w-]+))?$/);
    if(workspaceRoute){const [,id,layoutId]=workspaceRoute;if(req.method==='GET'&&!layoutId)return send(res,200,workspaces.list(id));if(req.method==='POST'&&!layoutId)return send(res,200,workspaces.save(id,await body(req)));if(req.method==='DELETE'&&layoutId)return send(res,200,workspaces.remove(id,layoutId));}
    const sessionRoute=route.match(/^\/api\/sessions\/([\w-]+)\/([\w-]+)(?:\/(control))?$/);
    if(sessionRoute){const [,runId,nodeId,action]=sessionRoute;if(req.method==='GET'&&!action)return send(res,200,sessions.status(runId,nodeId));if(req.method==='POST'&&action==='control')return send(res,202,sessions.control(runId,nodeId,await body(req)));}
    const terminalRoute=route.match(/^\/api\/terminals\/([\w-]+)\/([\w-]+)(?:\/(open|input))?$/);
    if(terminalRoute){const [,runId,nodeId,action]=terminalRoute;if(req.method==='GET'&&!action)return send(res,200,await terminals.status(runId,nodeId));if(req.method==='POST'&&action==='open')return send(res,200,await terminals.open(runId,nodeId));if(req.method==='POST'&&action==='input')return send(res,200,await terminals.send(runId,nodeId,await body(req)));}
    let match=route.match(/^\/api\/projects\/([\w-]+)(?:\/(plan|run|continue|lessons|capabilities))?$/);
    if(match){const [,id,action]=match;if(req.method==='GET'&&action==='capabilities')return send(res,200,await engine.capabilities(id));if(req.method==='GET'&&!action)return send(res,200,engine.project(id));if(req.method==='PUT'&&!action)return send(res,200,engine.updateProject(id,await body(req)));if(req.method==='POST'){if(action==='plan')return send(res,202,await engine.plan(id));if(action==='run')return send(res,202,engine.start(id));if(action==='continue')return send(res,202,engine.continueMaster(id,(await body(req)).nodeId));if(action==='lessons')return send(res,200,engine.lesson(id,(await body(req)).text));}}
    match=route.match(/^\/api\/runs\/([\w-]+)(?:\/(stop|retry|logs|files))?$/);
    if(match){const [,id,action]=match;const run=engine.run(id);if(req.method==='GET'&&!action)return send(res,200,run);if(req.method==='POST'&&action==='stop')return send(res,200,engine.stop(id));if(req.method==='POST'&&action==='retry')return send(res,202,engine.retry(id,(await body(req)).nodeId));if(req.method==='GET'&&action==='logs'){const node=url.searchParams.get('node');if(!run.states[node])throw new Error('Узел не найден.');const source=run.states[node].reusedFrom||id;const file=engine.file('runs',source,node,'events.jsonl');return send(res,200,{text:fs.existsSync(file)?fs.readFileSync(file,'utf8').slice(-120000):'Процесс ещё не прислал событий.'});}if(req.method==='GET'&&action==='files'){const relative=url.searchParams.get('path')||'';const base=engine.file('runs',id);return send(res,200,fs.statSync(safePath(base,relative)).isDirectory()?{files:listFiles(base,relative)}:{text:textFile(base,relative)});}}
    if(req.method==='GET'&&['/','/graph-ui.html','/app.js','/styles.css','/ui-format.js','/graph-icon.svg','/session-workspace.js','/workspace-layout.js','/sessions.css','/assets/openai.svg','/assets/claude.svg'].includes(route)){const file=route==='/'?'graph-ui.html':route.slice(1);return send(res,200,fs.readFileSync(path.join(root,file)),file.endsWith('.svg')?'image/svg+xml':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');}
    send(res,404,{error:'Не найдено.'});
  }catch(e){send(res,400,{error:e.message});}
});
server.listen(config.port,'127.0.0.1',()=>console.log(`Graph Studio: http://127.0.0.1:${config.port}\nData: ${config.dataRoot}`));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
