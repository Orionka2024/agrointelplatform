import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {issueOfficialForecast} from '../shared/officialForecast.js';
const root=new URL('../',import.meta.url);
const history=JSON.parse(fs.readFileSync(new URL('data/official-history.json',root),'utf8'));
const driversUrl=new URL('data/official-drivers.json',root);
const drivers=fs.existsSync(driversUrl)?JSON.parse(fs.readFileSync(driversUrl,'utf8')):null;
const issueDate=process.argv[2]||new Date().toISOString().slice(0,10);
const fc=issueOfficialForecast(history,{issueDate,drivers});
fc.id='official-'+createHash('sha256').update(JSON.stringify(fc)).digest('hex').slice(0,20);
const text=JSON.stringify(fc,null,2)+'\n';
const archive=new URL('data/official-forecasts/',root);fs.mkdirSync(archive,{recursive:true});
const path=new URL(fc.id+'.json',archive);
if(fs.existsSync(path)&&fs.readFileSync(path,'utf8')!==text)throw new Error('Immutable forecast collision');
fs.writeFileSync(path,text);
fs.writeFileSync(new URL('data/official-forecast.json',root),text);
const short=r=>r===null||r===undefined?null:Math.round(r*100)/100;
console.log(JSON.stringify({id:fc.id,status:fc.status,cutoff:fc.inputCutoff,usesDrivers:!!fc.drivers,
  rows:fc.rows.map(r=>({target:r.targetMonth,point:short(r.point),model:r.validation.selected,mae:short(r.validation.final.mae),naive:short(r.validation.naiveFinal.mae),n:r.validation.final.n,
   finalAll:Object.fromEntries(r.validation.finalAll.map(x=>[x.id,short(x.mae)]))}))},null,2));
