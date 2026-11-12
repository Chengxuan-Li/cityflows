import fs from 'node:fs';
const variant = process.argv[2];
if (!['granted-same','granted-diverging'].includes(variant)) throw Error(variant);
let file='src/sim/engine.ts', data=fs.readFileSync(file,'utf8');
data=data.replace('  let railCrossings = createRailCrossings', '  (globalThis as any).diagJunction147=intersections;\n  let railCrossings = createRailCrossings');
fs.writeFileSync(file,data);
file='src/sim/rail-crossings.ts'; data=fs.readFileSync(file,'utf8');
const marker='  function roadOccupancy() {';
data=data.replace(marker,`  function canClearGrantedLeader(tail:number, id:number, f:number, segment:number, s:number) {
    if(vehicles.state[tail]!==DRIVING || vehicles.speed[tail]! <= 0.1)return false;
    const ints=(globalThis as any).diagJunction147;
    const m=ints.grants[tail];
    if(m==null || m<0 || (segment<0 ? -segment-1!==m : vehicles.movement[tail]!==m))return false;
    const move=city.movements[m]!, lane=city.lanes[move.toLane]!;
    const followerMove = segment<0 ? -segment-1 : -(segments[s+1]??0)-1;
    if(${variant==='granted-same'?'m!==followerMove':'false'})return false;
    if(ints.zoneStop(move, segment<0 ? vehicles.position[tail]! : 0)<Infinity)return false;
    const after=spansBySegment[bucket(move.toLane)]!.reduce((high,b)=>Math.max(high,b.to),0);
    const gap=params.idm.minGapM;
    let free=lane.stopM;
    for(const c of lane.connectors)free=Math.min(free,city.connectors[c]!.positionM-maxLength-gap);
    for(const at of walkStops[lane.idx]!)free=Math.min(free,at);
    const stopped=vehicles.last(lane.idx);
    if(stopped!==-1)free=Math.min(free,vehicles.position[stopped]!-length(stopped)-gap);
    for(const incoming of lane.in){
      for(let j=vehicles.first(-incoming-1);j!==-1;j=vehicles.next[j]!)if(j!==tail)free-=length(j)+gap;
      for(let j=vehicles.first(city.movements[incoming]!.fromLane);j!==-1;j=vehicles.next[j]!)if(j!==tail && ints.grants[j]===incoming)free-=length(j)+gap;
    }
    return free-after >= length(tail)+gap+length(id)+gap;
  }
`+marker);
const old='              (segment !== field || !platoonFits(id, f, end))';
if(!data.includes(old)) throw Error('marker');
data=data.replace(old,old+' &&\n              !canClearGrantedLeader(tail,id,f,segment,s)');
fs.writeFileSync(file,data);
