import fs from 'node:fs';
const p='src/sim/rail-crossings.ts', variant=process.argv[2];let s=fs.readFileSync(p,'utf8');
s=s.replace('  function publish() {',`  const protectAudit=new Map<string,number>(); (globalThis as any).__protect147=protectAudit;
  const clearTimes=new WeakMap<Service,Map<Event,number>>();
  function publish() {`);
const marker='        const state =\n          service.ageS >= event.enterS';
if(!s.includes(marker))throw Error('state marker');
s=s.replace(marker,`        if(event.facility===2){
          const phase=service.ageS>event.exitS?'post':service.ageS<event.enterS?'lead':'inside';
          const blockers=events[route]!.filter(e=>occupied[e.facility] && service.ageS<=e.enterS && service.ageS+params.dtS>=e.enterS-params.dtS).map(e=>e.facility).join('+');
          const key=[phase,service.held ? (blockers||'track'):'moving',occupied[2]].join(':');
          protectAudit.set(key,(protectAudit.get(key)??0)+1);
        }
        ${variant==='wall-grace'?`if(service.ageS>event.exitS){
          const times=clearTimes.get(service)??new Map<Event,number>(); clearTimes.set(service,times);
          if(!times.has(event))times.set(event,snapshotTimeS);
          if(snapshotTimeS-times.get(event)!>=1)continue;
        }`:''}
        const state =
          service.ageS >= event.enterS`);
fs.writeFileSync(p,s);
