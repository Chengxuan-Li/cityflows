import fs from 'node:fs';const file='src/sim/intersection.ts';let s=fs.readFileSync(file,'utf8');
const m='    const exitTail = vehicles.last(movement.toLane);';
const code=`
    const entry=compiled.roads[compiled.lanes[movement.toLane]!.road]!.id;
    if(entry==='r:248' || entry==='r:364'){
      const lane=compiled.lanes[movement.toLane]!;
      let space=lane.stopM;
      if(exitTail!==-1)space=Math.min(space,vehicles.position[exitTail]!-profile(exitTail).lengthM);
      for(const mid of lane.in){
        for(let body=vehicles.first(-mid-1);body!==-1;body=vehicles.next[body]!)if(body!==id)space-=profile(body).lengthM+params.idm.minGapM;
        const src=compiled.movements[mid]!.fromLane;
        for(let body=vehicles.first(src);body!==-1;body=vehicles.next[body]!)if(body!==id && grants[body]===mid)space-=profile(body).lengthM+params.idm.minGapM;
      }
      if(space < clearance)return 'exit-full';
    }`;
if(!s.includes(m))throw Error('blockedExit marker');s=s.replace(m,m+code);fs.writeFileSync(file,s);
