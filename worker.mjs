import {readJSON} from './lib/storage.mjs';
import {runJob} from './lib/worker-runtime.mjs';
const result=await runJob(readJSON(process.argv[2]));
if(!result.ok)process.exitCode=1;
