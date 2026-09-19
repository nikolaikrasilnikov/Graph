import {randomUUID} from 'node:crypto';
import {readJSON,writeJSON} from './storage.mjs';
import {validateLayout} from '../workspace-layout.js';
export class Workspaces {
  constructor(engine){this.engine=engine;}
  file(projectId){this.engine.project(projectId);return this.engine.file('projects',projectId,'workspaces.json');}
  list(projectId){return readJSON(this.file(projectId),[]);}
  save(projectId,value){const layout=validateLayout(value),all=this.list(projectId);let id=value.id;if(id&&!all.some(x=>x.id===id))throw new Error('Раскладка не найдена.');if(!id&&all.length>=30)throw new Error('Можно сохранить до 30 раскладок.');id ||=randomUUID();const item={...layout,id,updatedAt:new Date().toISOString()};writeJSON(this.file(projectId),[...all.filter(x=>x.id!==id),item]);return item;}
  remove(projectId,id){const all=this.list(projectId);if(!all.some(x=>x.id===id))throw new Error('Раскладка не найдена.');writeJSON(this.file(projectId),all.filter(x=>x.id!==id));return {deleted:true};}
}
