import fs from 'node:fs';
const p='src/sim/intersection.ts';let s=fs.readFileSync(p,'utf8');
s="import {railTimetable} from '../network/trams';\n"+s;
const marker='  const compare = (a: number, b: number) =>';
if(!s.includes(marker)) throw Error('compare');
s=s.replace(marker,`  const servedRail = new Set<number>();
  const rail = compiled.rail;
  if(rail){const timetable=railTimetable(rail); for (const d of timetable.departures)for(const sec of timetable.routes[d.route]!.sections)servedRail.add(sec.track);}
  const spans = compiled.lanes.map(()=>[] as {fromM:number;toM:number}[]);
  for(const facility of rail?.facilities??[]){
    if(!facility.railSpans?.some(v=>servedRail.has(v.track)))continue;
    for(const span of facility.spans??[])if(span.segment>=0)spans[span.segment]!.push(span);
  }
  const exitingBand = (id:number) => {
    const lane=vehicles.lane[id]!, front=vehicles.position[id]!;
    return spans[lane]?.some(s=>front>=s.fromM && front-profile(id).lengthM<=s.toM) && signalAllows(id,movementOf(id)) && !blockedExit(id,movementOf(id));
  };
  const clearFirst = (a:number,b:number)=>{
    const diff=Number(!!exitingBand(b))-Number(!!exitingBand(a));
    if(diff && movementOf(a).conflicts.includes(movementOf(b).idx))(globalThis as any).__egressComparisons=((globalThis as any).__egressComparisons??0)+1;
    return diff;
  };
  const compare = (a: number, b: number) =>
    clearFirst(a,b) ||`);
fs.writeFileSync(p,s);
