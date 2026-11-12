import fs from 'node:fs';
const name=process.argv[2], p='src/sim/rail-crossings.ts';
let s=fs.readFileSync(p,'utf8');
if(name==='2-no-warning')s=s.replace('states[event.facility] = Math.max(states[event.facility]!, state);','if(event.facility!==2) states[event.facility] = Math.max(states[event.facility]!, state);');
if(name==='2-no-tail')s=s.replace('              tail !== -1 &&\n              tail !== id &&','              f !== 2 &&\n              tail !== -1 &&\n              tail !== id &&');
if(name==='2-no-red')s=s.replace('                next !== undefined &&\n                next < 0 &&\n                red(-next - 1)','                f !== 2 &&\n                next !== undefined &&\n                next < 0 &&\n                red(-next - 1)');
if(s===fs.readFileSync(p,'utf8'))throw Error('probe injection missing '+name);
fs.writeFileSync(p,s);
