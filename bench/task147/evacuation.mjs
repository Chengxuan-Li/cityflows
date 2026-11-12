import fs from 'node:fs';
const variant=process.argv[2];const p='src/sim/rail-crossings.ts',e='src/sim/engine.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace('  roadState?: RoadState,','  roadState?: RoadState,\n  blockedMovement?: (m:number) => boolean,');
const marker='            if (offset > clear) break;';
if(!s.includes(marker))throw Error('clearance marker');
s=s.replace(marker,marker+`
            if(segment<0 && offset<clear && offset+segmentLength(segment)>stop && blockedMovement?.(-segment-1))blocked=true;`);
fs.writeFileSync(p,s);
s=fs.readFileSync(e,'utf8');
const check=`(m:number) => {
    const movement=compiled.movements[m]!;
    if(intersections.zoneStop(movement,0)<Infinity)return true;
    ${variant==='reserved'?`for(const rival of movement.conflicts)for(let body=vehicles.first(-rival-1);body!==-1;body=vehicles.next[body]!)if(vehicles.speed[body]!<0.1)return true;`:''}
    return false;
  }`;
const original='    intersections.red(m),\n  );';if(!s.includes(original))throw Error('engine marker');
s=s.replace(original,'    intersections.red(m),undefined,undefined,'+check+',\n  );');
s=s.replace('      railCrossings?.roadState(changes),','      railCrossings?.roadState(changes),'+check+',');
fs.writeFileSync(e,s);
