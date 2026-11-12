import {loadAuditCity} from '../../bench/junction-audit';
import {compile,signalStateAt} from '../../src/network';
import {railTimetable} from '../../src/network/trams';
import {probeMorning} from '../../bench/import-probe';
const variant=process.argv[2]??'base', untilS=Number(process.argv[3]??36000);
const city=loadAuditCity('munich'),result=compile(city);if(!result.ok)throw Error('compile');const c=result.compiled;
if(variant.startsWith('omit-')){const omit=Number(variant.slice(5)); c.rail!.facilities=c.rail!.facilities!.filter((_,i)=>i!==omit);}
if(variant==='open')railTimetable(c.rail!).departures=[];
if(variant==='none')c.rail!.facilities=[];
const holdCounts:Record<string,number>={};const holdIds=new Map<string,Set<number>>();(globalThis as any).__rail147=(h:any,id:number)=>{const key=[h.facility,h.state,h.cause].join(':');holdCounts[key]=(holdCounts[key]??0)+1;const ids=holdIds.get(key)??new Set();ids.add(id);holdIds.set(key,ids);};
const controllers=c.rail!.facilities!.map(f=>{const result=new Set<number>(),seen=new Set<number>();function visit(m:number,left=100){if(seen.has(m)||left<0)return;seen.add(m);const move=c.movements[m]!,signal=c.nodes[move.node]!.signal;if(signal && signal.phases.some(p=>!p.movements.includes(m))){result.add(m);return;}const lane=c.lanes[move.fromLane]!;for(const incoming of lane.in)visit(incoming,left-lane.lengthM-move.lengthM);}for(const span of f.spans!){if(span.segment<0)visit(-span.segment-1);else for(const m of c.lanes[span.segment]!.in)visit(m);}return [...result];});
const lostGreen=controllers.map(()=>0);console.log('CONTROLLERS',JSON.stringify(controllers.map(ms=>ms.map(m=>c.movements[m]!.id))));
const start=performance.now();const counts=c.rail!.facilities!.map(()=>({closed:0,open:0}));
const out=probeMorning(city,c,.15,{untilS,observe(e){if(Math.round(e.timeS*10)%100)return;const s=e.snapshot();s.rail!.crossings.forEach((v,f)=>{counts[f]![v?'closed':'open']++;if(v){const lanes=new Set(controllers[f]!.filter(m=>{const signal=c.nodes[c.movements[m]!.node]!.signal!;const at=signalStateAt(signal,e.timeS);return at.state==='green' && signal.phases[at.phase]!.movements.includes(m);}).map(m=>c.movements[m]!.fromLane));lostGreen[f]!+=lanes.size*10;}});if(Math.round(e.timeS)%1800===0)console.log(JSON.stringify({time:e.timeS,trips:e.metrics().trips}));}});
console.log(JSON.stringify({variant,counts,lostGreen,holdCounts,holdUnique:Object.fromEntries([...holdIds].map(([k,v])=>[k,v.size])),wallS:(performance.now()-start)/1000,...out}));


console.log('PHASE147',JSON.stringify((globalThis as any).__phase147));
console.log('REASON147',JSON.stringify(Object.fromEntries((globalThis as any).__protect147 ?? [])));
