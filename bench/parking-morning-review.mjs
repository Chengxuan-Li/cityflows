import { writeFileSync } from 'node:fs';
import { loadAuditCity } from './junction-audit.ts';
import { compile } from '../src/network/index.ts';
import { probeMorning } from './import-probe.ts';
const city=loadAuditCity('munich'), compiled=compile(city);
if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
const n=compiled.compiled;
let engine;
const run=probeMorning(city,n,.15,{observe(e){engine=e;}});
const issues=[], destinations={}, sources={}, visits={};
for(let id=1;id<=run.trips;id++) {
 const d=engine.inspect(id);
 if(!d)continue;
 if(d.parkingFacility){const key=d.parkingFacility+' '+d.state; visits[key]=(visits[key]??0)+1;}
 if(d.failReason==='gridlocked' || d.failReason==='no_parking') {
  const lane=n.lanes[d.lane]??n.lanes[n.movements[-d.lane-1]?.fromLane];
  issues.push({trip:d.tripId,purpose:d.purpose,vehicle:d.vehicleClass,state:d.state,reason:d.failReason,origin:d.originPlace,destination:d.destinationPlace,facility:d.parkingFacility,lane:lane?.id,position:d.positionM,wait:d.waitingS,route:d.route?.roads.map(r=>n.roads[r].id),departed:d.departedS});
  destinations[d.destinationPlace]=(destinations[d.destinationPlace]??0)+1;
  sources[d.originPlace]=(sources[d.originPlace]??0)+1;
 }
}
const summary={completed:run.completed,failed:run.failedByReason,stalled:run.stalledHeadDetails,gridlockedRoads:run.gridlockedRoads,parking:run.parking,topDetourRoads:Object.entries(run.headDetourRoads).sort((a,b)=>b[1]-a[1]).slice(0,12),visits,issues,sources,destinations};
writeFileSync('parking-morning.json',JSON.stringify(summary,null,2));
console.info(JSON.stringify({completed:summary.completed,failed:summary.failed,gridlockedRoads:summary.gridlockedRoads,stalled:summary.stalled}));
