import fs from 'node:fs';
const p='src/sim/rail-crossings.ts';let s=fs.readFileSync(p,'utf8');
s=s.replace('  function roadOccupancy() {',`  const roadWaitExamples=new Map<string,any>();const roadWaitCounts:Record<string,number>={};
  (globalThis as any).__roadWait147={counts:roadWaitCounts,examples:roadWaitExamples};
  function roadOccupancy() {`);
const marker='        // A delayed train keeps its physical track reservation';
if(!s.includes(marker))throw Error('marker missing');
s=s.replace(marker,`        if(service.held && Math.round(timeS*10)%10===0){
          for(const event of events[route]!){
            const f=event.facility;
            if(!occupied[f] || service.ageS>event.enterS || next<event.enterS-params.dtS || (f!==1 && f!==2))continue;
            for(const id of committed[f]!){
              const lane=vehicles.lane[id]!,l=lane>=0?city.lanes[lane]:undefined,m=vehicles.movement[id]!, ahead=vehicles.previous[id]!,actual=overlaps(f,lane,vehicles.position[id]!,vehicles.position[id]!-length(id));
              const idName=l?.id??city.movements[-lane-1]?.id, isred=m>=0&&red(m), speed=vehicles.speed[id]!;
              const key=[f,idName,actual?'physical':'approach/tail',speed<0.1?'stopped':'moving',isred?'red':'go'].join('/');
              roadWaitCounts[key]=(roadWaitCounts[key]??0)+1;
              if(!roadWaitExamples.has(key))roadWaitExamples.set(key,{id,timeS,lane:idName,pos:vehicles.position[id],length:length(id),speed,movement:city.movements[m]?.id,ahead:ahead>=0?{id:ahead,pos:vehicles.position[ahead],speed:vehicles.speed[ahead]}:null,segmentLength:segmentLength(lane),stopM:l?.stopM,crossings:[...states],nextRoads:vehicles.route[id]?.roads.map(r=>city.roads[r]!.id).slice(vehicles.routeStep[id]!,vehicles.routeStep[id]!+6)});
            }
          }
        }
`+marker);
fs.writeFileSync(p,s);
