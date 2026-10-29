import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(path.join(tmpdir(),'agro-test-'));
try {const r=spawnSync(process.execPath,['--test','test/*.test.js'],{stdio:'inherit',env:{...process.env,DATA_DIR:dir,AGRO_TEST:'1',GEMINI_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',AI_PROVIDER:''}});process.exitCode=r.status??1;} finally {rmSync(dir,{recursive:true,force:true});}
