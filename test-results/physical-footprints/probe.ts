import {writeFileSync} from 'node:fs';
import {loadAuditCity} from '../../bench/junction-audit.ts';
import {compile} from '../../src/network/index.ts';
import type {TrafficEngine} from '../../src/sim/types.ts';
import {probeMorning} from '../../bench/import-probe.ts';
import {DEFAULT_SIM_PARAMS} from '../../src/sim/params.ts';
import {defaultScenario} from '../../src/fixtures/scenarios.ts';
import {railTimetable} from '../../src/network/trams.ts';
import {trainDefaults} from '../../src/network/trains.ts';
import {laneChangePose} from '../../src/render/vehicle-pose.ts';
import {pointInPolygon,segmentDistance,segmentIntersection} from '../../src/geo/polyline.ts';

type Box={x:number;y:number;heading:number;length:number;width:number};
function separation(a:Box,b:Box){
 const au={x:Math.cos(a.heading),y:Math.sin(a.heading)},av={x:-au.y,y:au.x},bu={x:Math.cos(b.heading),y:Math.sin(b.heading)},bv={x:-bu.y,y:bu.x};
 let maximum=-Infinity;
 for(const axis of [au,av,bu,bv]){
  const ra=Math.abs(axis.x*au.x+axis.y*au.y)*a.length/2+Math.abs(axis.x*av.x+axis.y*av.y)*a.width/2;
  const rb=Math.abs(axis.x*bu.x+axis.y*bu.y)*b.length/2+Math.abs(axis.x*bv.x+axis.y*bv.y)*b.width/2;
  maximum=Math.max(maximum,Math.abs((a.x-b.x)*axis.x+(a.y-b.y)*axis.y)-ra-rb);
 }
 return maximum;
}
function capsulePenetration(car:Box,train:Box){
 const offset=(box:Box,x:number,y:number)=>({x:box.x+Math.cos(box.heading)*x-Math.sin(box.heading)*y,y:box.y+Math.sin(box.heading)*x+Math.cos(box.heading)*y});
 const a=offset(car,-(car.length-car.width)/2,0),b=offset(car,(car.length-car.width)/2,0);
 const corners=[offset(train,-train.length/2,-train.width/2),offset(train,train.length/2,-train.width/2),offset(train,train.length/2,train.width/2),offset(train,-train.length/2,train.width/2)];
 let distance=pointInPolygon(a,[...corners,corners[0]!])||pointInPolygon(b,[...corners,corners[0]!])?0:Infinity;
 for(let i=0;i<4;i++){const p=corners[i]!,q=corners[(i+1)%4]!;distance=Math.min(distance,segmentIntersection(a,b,p,q)?0:Math.min(segmentDistance(a,p,q),segmentDistance(b,p,q),segmentDistance(p,a,b),segmentDistance(q,a,b)));}
 return car.width/2-distance;
}
const source=loadAuditCity('munich'),result=compile(source);if(!result.ok)throw Error('compile');const c=result.compiled;
const scenario=defaultScenario('grid5x5');scenario.startS=25200;scenario.endS=36000;scenario.demand.personsPerResident=.15;
const table=railTimetable(c.rail!),facilities=c.rail!.facilities!;let engine:TrafficEngine;
const kinds=['car','van','truck','bus'] as const;
const nodes=facilities.map(f=>c.rail!.nodes.filter(n=>f.nodes.includes(n.id)).map(n=>n.pos));
const near=(box:Box,fi:number)=>nodes[fi]!.some(p=>Math.hypot(box.x-p.x,box.y-p.y)<45+box.length/2);
const stats=facilities.map((f,i)=>({i,roads:f.approaches.map(a=>a.roadId),serviceEntries:0,serviceExits:0,nearSamples:0,boxTests:0,obbContacts:0,scopedSamples:0,minimumSeparationM:Infinity,services:new Set<string>(),encounters:new Set<string>(),scopedEncounters:new Set<string>(),active:new Set<string>()}));
const outside=new Map<string,any>();
function roadInside(car:any,f:any){
 const d=car.detail??=engine.inspect(car.id)!;
 let segment=d.lane,front=d.positionM,rear=front-car.box.length;
 let step=segment>=0?d.route?.roads.indexOf(c.lanes[segment]!.road):d.route?.movements.indexOf(-segment-1);
 for(let back=0;back<20;back++){
  if(f.spans?.some((s:any)=>s.segment===segment&&front>=s.fromM&&rear<=s.toM))return true;
  if(rear>=0)break;
  if(segment<0)segment=c.movements[-segment-1]!.fromLane;
  else{const m=d.route?.movements[--step];if(m===undefined)break;segment=-m-1;}
  front=segment>=0?c.lanes[segment]!.lengthM:c.movements[-segment-1]!.lengthM;rear+=front;
 }
 return false;
}
const vehicleHistory=new Map<number,unknown[]>(),trainHistory=new Map<string,unknown[]>();
const began=performance.now();let collision:any=null,lastTime=scenario.startS,tick=0;
function sample(current:TrafficEngine){
 engine=current;tick++;const s=engine.snapshot(),r=s.rail!;lastTime=s.timeS;
 const roads:any[]=[];
 for(let i=0;i<s.count;i++){
  let front={x:s.x[i]!,y:s.y[i]!},heading=s.heading[i]!,field=s.lane[i]!;
  const reference=(s.poseLane?.[i]??-1)>=0?s.poseLane![i]!:field;
  if(reference< -c.movements.length)continue;
  const lane=reference>=0?c.lanes[reference]!:c.lanes[c.movements[-reference-1]!.fromLane]!;
  const road=source.roads[c.roads[lane.road]!.id]!,grade=road.layer??Math.min(source.nodes[road.from]!.layer,source.nodes[road.to]!.layer);
  const cls=kinds[s.vclass[i]!]!,dimensions=DEFAULT_SIM_PARAMS.vehicleClasses[cls];
  if((s.poseLane?.[i]??-1)<0&&field>=0&&s.lateralM[i]!==0){
   const target=c.lanes[field]!,from=c.lanes[s.lateralM[i]!>0?target.right:target.left]!;
   const pose=laneChangePose(s.lateralM[i]!, (target.widthM+from.widthM)/2,DEFAULT_SIM_PARAMS.laneChangeDurationS,0);
   front={x:front.x-Math.sin(heading)*pose.lateral,y:front.y+Math.cos(heading)*pose.lateral};heading+=pose.yaw;
  }
  const box={x:front.x-Math.cos(heading)*dimensions.lengthM/2,y:front.y-Math.sin(heading)*dimensions.lengthM/2,heading,length:dimensions.lengthM,width:dimensions.widthM};
  if(!facilities.some((f,fi)=>f.layer===grade&&near(box,fi)))continue;
  const car={id:s.id[i]!,index:i,field,grade,front,box,speed:s.speed[i],class:cls};roads.push(car);
  const h=vehicleHistory.get(car.id)??[];h.push({time:s.timeS,...car});if(h.length>20)h.shift();vehicleHistory.set(car.id,h);
 }
 for(const train of r.trains){const h=trainHistory.get(train.id)??[];h.push({time:s.timeS,positionM:train.positionM,speed:train.speedMps,cars:train.cars});if(h.length>20)h.shift();trainHistory.set(train.id,h);}
 for(let fi=0;fi<facilities.length;fi++){
  const f=facilities[fi]!,st=stats[fi]!,active=new Set<string>();
  for(const train of r.trains){
   const route=table.routes[train.route]!,half=trainDefaults[train.kind].lengthM/2;
   const inCrossing=f.railSpans?.some(span=>route.sections.some(section=>{
    if(section.track!==span.track)return false;const track=c.rail!.tracks[span.track]!;
    const lo=section.startM+(section.forward?span.fromM:track.lengthM-span.toM),hi=section.startM+(section.forward?span.toM:track.lengthM-span.fromM);
    return train.positionM+half>=lo&&train.positionM-half<=hi;
   }));
   if(inCrossing){active.add(train.id);if(!st.services.has(train.id)){st.services.add(train.id);st.serviceEntries++;}}
   for(let k=0;k<train.cars.length;k++){
    const carriage=train.cars[k]!,track=c.rail!.tracks[carriage.track]!;
    if(track.bridge||track.tunnel&&!track.covered)continue;
    const railBox={x:carriage.x,y:carriage.y,heading:carriage.heading,length:carriage.lengthM,width:train.kind==='tram'?2.4:3};
    if(!near(railBox,fi))continue;
    const section=route.sections.filter(section=>section.track===carriage.track).sort((a,b)=>Math.abs(a.startM-train.positionM)-Math.abs(b.startM-train.positionM))[0]!;
    const carriageM=section.startM+(section.forward?carriage.trackM:track.lengthM-carriage.trackM);
    const railInside=f.railSpans?.some(span=>route.sections.some(section=>{
      if(section.track!==span.track)return false;const t=c.rail!.tracks[span.track]!;
      const lo=section.startM+(section.forward?span.fromM:t.lengthM-span.toM),hi=section.startM+(section.forward?span.toM:t.lengthM-span.fromM);
      return carriageM+carriage.lengthM/2>=lo&&carriageM-carriage.lengthM/2<=hi;
    }));
    for(const car of roads){
     if(car.grade!==f.layer||!near(car.box,fi))continue;
     if(Math.hypot(car.box.x-railBox.x,car.box.y-railBox.y)>(car.box.length+railBox.length)/2+6)continue;
     const gap=separation(car.box,railBox);st.boxTests++;st.minimumSeparationM=Math.min(st.minimumSeparationM,gap);
     if(gap>5)continue;st.nearSamples++;st.encounters.add(`${car.id}/${train.id}`);
     const inMappedConflict=railInside&&roadInside(car,f);
     if(inMappedConflict){st.scopedSamples++;st.scopedEncounters.add(`${car.id}/${train.id}`);}
     if(gap < -0.001){
      st.obbContacts++;
      const core={...car.box,length:Math.max(.1,car.box.length-.5),width:Math.max(.1,car.box.width-.2)};
      const coreGap=separation(core,railBox);
      const physicalPenetration=car.class==='car'?capsulePenetration(car.box,railBox):-coreGap;
      const witness={time:s.timeS,facility:fi,phase:r.crossings[fi],ready:r.railReady[fi],gap,coreGap,physicalPenetration,inMappedConflict,car:{...car,detail:engine.inspect(car.id)},train:{id:train.id,route:train.route,positionM:train.positionM,speed:train.speedMps,occupied:train.occupied,carriageIndex:k,carriage,box:railBox},vehicleHistory:vehicleHistory.get(car.id),trainHistory:trainHistory.get(train.id)};
      if(physicalPenetration>.02){
       if(inMappedConflict){collision=witness;break;}
       const lane=car.field>=0?c.lanes[car.field]!:c.lanes[c.movements[-car.field-1]!.fromLane]!,road=c.roads[lane.road]!.id,key=`${road}/${track.id}`;
       const row=outside.get(key)??{task:'TASK-139',road,track:track.id,firstS:s.timeS,lastS:s.timeS,times:new Set<number>(),pairs:new Set<string>(),maximumPenetrationM:0,firstWitness:witness};
       row.lastS=s.timeS;row.times.add(s.timeS);row.pairs.add(`${car.id}/${train.id}`);row.maximumPenetrationM=Math.max(row.maximumPenetrationM,physicalPenetration);outside.set(key,row);
      }
     }
    }
    if(collision)break;
   }
   if(collision)break;
  }
  for(const id of st.active)if(!active.has(id))st.serviceExits++;
  st.active=active;
  if(collision)break;
 }
 if(tick%3000===0)console.log('progress',JSON.stringify({time:s.timeS,driving:s.count,elapsedS:(performance.now()-began)/1000,stats:stats.map(({services,encounters,scopedEncounters,active,...st})=>({...st,uniqueNearEncounters:encounters.size,uniqueMappedNearEncounters:scopedEncounters.size})),outsideRoadTracks:outside.size}));
 if(collision)throw Error('Mapped rail contact');
}
let outcome;try {outcome=probeMorning(source,c,.15,{untilS:Number(process.argv[3]??36000),observe:sample});}catch(error){if(!collision)throw error;}
const report={revision:process.argv[2]??'147-worktree',morning:outcome && {completed:outcome.completed,failedByReason:outcome.failedByReason,stalledHeads:outcome.stalledHeads},sampleS:.1,startS:scenario.startS,endS:lastTime,elapsedS:(performance.now()-began)/1000,stats:stats.map(({services,encounters,scopedEncounters,active,...st})=>({...st,serviceIds:[...services],uniqueNearEncounters:encounters.size,uniqueMappedNearEncounters:scopedEncounters.size})),outside:[...outside.values()].map(({times,pairs,...row})=>({...row,contactSamples:times.size,uniquePairs:pairs.size})),collision};
writeFileSync('test-results/physical-footprints/report.json',JSON.stringify(report,null,2));
if(collision)writeFileSync('test-results/physical-footprints/collision.json',JSON.stringify(collision,null,2));
console.log('final',JSON.stringify({...report,outside:report.outside.map(({firstWitness,...row})=>row),collision:collision?{time:collision.time,facility:collision.facility,gap:collision.gap,physicalPenetration:collision.physicalPenetration,car:collision.car.id,train:collision.train.id}:null,stats:report.stats.map(({serviceIds,...st})=>st)}));
