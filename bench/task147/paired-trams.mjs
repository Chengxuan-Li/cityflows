import fs from 'node:fs';
const p='src/sim/rail-crossings.ts';let s=fs.readFileSync(p,'utf8');
const helper=`  const jointCalls=new WeakMap<Service,{age:number,until:number}>();
  const trackSets=table.routes.map(r=>new Set(r.sections.map(s=>s.track)));
  function waitForParallel(sv:Service, route:number, timeS:number, next:number){
    if(table.routes[route]!.kind!=='tram')return false;
    const evt=events[route]!.find(e=>sv.ageS<e.enterS-e.warningS && next>=e.enterS-e.warningS);
    if(!evt)return false;
    const previous=jointCalls.get(sv);
    if(previous?.age===evt.enterS)return timeS < previous.until;
    if(events[route]!.some(e=>e!==evt && sv.ageS>=e.enterS-e.warningS && sv.ageS<=e.exitS+1))return false;
    let wait=Infinity;
    for(const other of services){
      if(other===sv || other.held)continue;
      const r=table.departures[other.departure]!.route;
      if(table.routes[r]!.kind!=='tram'|| table.routes[r]!.sections.some(sec=>trackSets[route]!.has(sec.track)))continue;
      for(const e of events[r]!){
        if(e.facility!==evt.facility || other.ageS>=e.enterS-e.warningS)continue;
        const delay=e.enterS-other.ageS-(evt.enterS-sv.ageS);
        if(delay<params.dtS || delay>evt.exitS-evt.enterS+evt.warningS)continue;
        wait=Math.min(wait,delay);
      }
    }
    jointCalls.set(sv,{age:evt.enterS,until:timeS+(Number.isFinite(wait)?wait:0)});
    if(Number.isFinite(wait))(globalThis as any).__pairedTrams=((globalThis as any).__pairedTrams||0)+1;
    return Number.isFinite(wait);
  }
`;
s=s.replace('  const trackOwners = new Int32Array',helper+'  const trackOwners = new Int32Array');
const marker='        service.held = events[route]!.some(';
if(!s.includes(marker))throw Error('marker');
s=s.replace(marker,'        service.held = waitForParallel(service,route,timeS,next) || events[route]!.some(');
fs.writeFileSync(p,s);
