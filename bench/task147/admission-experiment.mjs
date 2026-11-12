import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const variant=process.argv[2];
if(!['no-vehicle','no-red'].includes(variant))throw Error('Expected no-vehicle or no-red');
let source=execFileSync('git',['show','38340cc:src/sim/rail-crossings.ts'],{encoding:'utf8'});
if(variant==='no-vehicle')source=source.replace('              tail !== -1 &&\n              tail !== id &&', '              false &&\n              tail !== -1 &&\n              tail !== id &&');
else source=source.replace('                next !== undefined &&\n                next < 0 &&\n                red(-next - 1)', '                false &&\n                next !== undefined &&\n                next < 0 &&\n                red(-next - 1)');
writeFileSync('src/sim/rail-crossings.ts',source);
