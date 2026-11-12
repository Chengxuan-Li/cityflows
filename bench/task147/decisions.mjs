import fs from 'node:fs';
let file='src/sim/engine.ts',s=fs.readFileSync(file,'utf8');s=s.replaceAll('onDecision: intersectionObserver,',`onDecision:(id,m,reason,other)=>{
  const ledger=(globalThis as any).__decision147??=new Map();
  ledger.set(id,{reason,m:m.idx,other:other?.idx});
  intersectionObserver?.(id,m,reason,other);
},`);fs.writeFileSync(file,s);
file='src/sim/rail-crossings.ts';s=fs.readFileSync(file,'utf8');
const keyMarker="              const key=[f,idName,actual?'physical':'approach/tail',speed<0.1?'stopped':'moving',isred?'red':'go'].join('/');";
if(!s.includes(keyMarker)) throw Error('key');
s=s.replace(keyMarker,`              if(!actual || speed>=0.1)continue;
              const ledger=(globalThis as any).__decision147, dec=ledger?.get(id), decision = dec?.m===m ? dec?.reason : 'unrequested';
              const body=(other:number)=>({id:other,pos:vehicles.position[other],speed:vehicles.speed[other],movement:city.movements[vehicles.movement[other]!]?.id,decision:ledger?.get(other),state:vehicles.state[other]});
              const bodies=(segment:number)=>{
                const res=[];for(let car=vehicles.first(segment);car!==-1;car=vehicles.next[car]!)res.push(body(car));return res;
              };
              const target=m>=0?city.movements[m]!.toLane:-1;
              const other=dec?.other!=null?city.movements[dec.other]:undefined;
              const ref=other?.id??'-';
              const key=[f,idName,decision,ref].join('/');
              `);
s=s.replace('segmentLength:segmentLength(lane),stopM:l?.stopM,',`segmentLength:segmentLength(lane),stopM:l?.stopM,dec,target:target>=0?{id:city.lanes[target]!.id,cars:bodies(target)}:null,competing:other?{physical:bodies(-other.idx-1),approach:bodies(other.fromLane),exit:bodies(other.toLane)}:null,`);
fs.writeFileSync(file,s);
