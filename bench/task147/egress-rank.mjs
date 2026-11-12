import fs from 'node:fs';
const p='src/sim/intersection.ts';let s=fs.readFileSync(p,'utf8');
s=s.replace('    clearFirst(a,b) ||','    classOf(b)-classOf(a) ||')
 .replace('  const clearFirst = (a:number,b:number)=>{','  const classOf=(id:number)=>Number(!!exitingBand(id) && !onRed(movementOf(id)));\n  const clearFirst = (a:number,b:number)=>{')
 .replace('while (end < queue.length && priority(queue[end]!) === rank) end++;','while (end < queue.length && priority(queue[end]!) === rank && classOf(queue[end]!)===classOf(queue[start]!)) end++;');
if(process.argv[2]==='direct')s=s.replace('classOf(b)-classOf(a) ||\n    priority(b) - priority(a)', 'priority(b) - priority(a) || classOf(b)-classOf(a)');
fs.writeFileSync(p,s);
