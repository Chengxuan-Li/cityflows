import fs from 'node:fs';
const p='src/sim/intersection.ts';let s=fs.readFileSync(p,'utf8');
if(!s.includes("import {railTimetable}"))s="import {railTimetable} from '../network/trams';\n"+s;
const marker='  function blockedExit(id: number, movement: CMovement)';
const helper=`  const railLanes = new Set<number>();
  const rail=compiled.rail;
  if(rail){
    const table=railTimetable(rail);
    const served=new Set(table.departures.flatMap(d=>table.routes[d.route]!.sections.map(sec=>sec.track)));
    for(const f of rail.facilities??[])if(f.railSpans?.some(span=>served.has(span.track))){
      for(const span of f.spans??[]){
        if(span.segment<0)continue;
        const lane=compiled.lanes[span.segment]!;
        if(span.toM>=lane.stopM-Math.max(...profiles.map(p=>p.lengthM))-params.idm.minGapM)railLanes.add(lane.idx);
      }
    }
  }
  const protectedExits = compiled.movements.map(m=>m.conflicts.flatMap((c,i)=>{
    const out=compiled.movements[c]!;
    if(!railLanes.has(out.fromLane))return [];
    return [{out,edge:m.conflictZones[i]![1]}];
  }));
  function occupiedExitThreat(m:CMovement){
    let edge=-Infinity;
    for(const {out,edge:at} of protectedExits[m.idx]!){
      const lane=compiled.lanes[out.fromLane]!;
      const front=vehicles.first(lane.idx);
      if(front!==-1 && vehicles.movement[front]===out.idx)edge=Math.max(edge,at);
      for(const mid of lane.in){
        const incoming=vehicles.first(-mid-1);
        if(incoming===-1)continue;
        const route=vehicles.route[incoming],step=vehicles.routeStep[incoming]!+1;
        if(compiled.lanes[out.toLane]!.road===route?.roads[step+1])edge=Math.max(edge,at);
      }
    }
    return edge;
  }
`;
if(!s.includes(marker))throw Error('blockedExit');
s=s.replace(marker,helper+marker);
const at='    const exitTail = vehicles.last(movement.toLane);';
s=s.replace(at,at+`
    const edge=occupiedExitThreat(movement);
    if(Number.isFinite(edge)){
      const lane=compiled.lanes[movement.toLane]!, gap=params.idm.minGapM;
      let free=movement.lengthM+Math.min(lane.stopM,exitTail===-1?Infinity:vehicles.position[exitTail]!-profile(exitTail).lengthM)-edge;
      for(const mid of lane.in){
        for(let j=vehicles.first(-mid-1);j!==-1;j=vehicles.next[j]!)if(j!==id)free-=profile(j).lengthM+gap;
        for(let j=vehicles.first(compiled.movements[mid]!.fromLane);j!==-1;j=vehicles.next[j]!)if(j!==id && grants[j]===mid)free-=profile(j).lengthM+gap;
      }
      if(free<clearance)return 'box';
    }`);
fs.writeFileSync(p,s);
