import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {importOsmCached} from './city-cache.ts';
import {compile} from '../src/network/index.ts';
import {trainTimetable} from '../src/network/trains.ts';
import {tramTimetable,railTimetable} from '../src/network/trams.ts';
import {createRouteProvider,freeFlowLinkCosts} from '../src/routing/index.ts';
import {throughputRequests} from '../tests/routing/throughput-fixtures.ts';
const moduleAt=(dir,path)=>import(pathToFileURL(resolve('..',dir,path)).href);
const geometry=await moduleAt('task147-geometry-control','src/importers/osm/index.ts'),geometryNetwork=await moduleAt('task147-geometry-control','src/network/index.ts'),geometryTrains=await moduleAt('task147-geometry-control','src/network/trains.ts');
const reviewed=await moduleAt('task147-reviewed-control','src/importers/osm/index.ts'),reviewedNetwork=await moduleAt('task147-reviewed-control','src/network/index.ts'),reviewedTrains=await moduleAt('task147-reviewed-control','src/network/trams.ts');
const json=JSON.stringify,hash=v=>createHash('sha256').update(json(v)).digest('hex');
const physicalProtection=n=>(n.rail.facilities??[]).map(f=>({...f,stops:f.stops?.map(s=>({...s,lane:n.lanes[s.lane].id})),spans:f.spans?.map(s=>({...s,segment:s.segment>=0?n.lanes[s.segment].id:n.movements[-s.segment-1].id})),railSpans:f.railSpans?.map(s=>({...s,track:n.rail.tracks[s.track].id}))}));
const cleanRail=r=>{const{tramStops,...rest}=r;return{...rest,facilities:rest.facilities?.map(f=>{const{stops,spans,railSpans,...old}=f;return old})}};
const output=[];
for(const name of ['munich-donnersberger','sindelfingen-a81']){
const xml=readFileSync(`fixtures/osm/${name}.osm`,'utf8'),options={importerVersion:'1',context:false,terrain:false},a=importOsmCached(xml,options),b=geometry.importOsm(xml,options),c=reviewed.importOsm(xml,options);if(!a.ok||!b.ok||!c.ok)throw Error('import');const an=compile(a.city),bn=geometryNetwork.compile(b.city),cn=reviewedNetwork.compile(c.city);if(!an.ok||!bn.ok||!cn.ok)throw Error('compile');const A=an.compiled,B=bn.compiled,C=cn.compiled;
const{rail:ar,...acar}=A,{rail:br,...bcar}=B;
const row={name,canonicalCityEqualGeometryBase:json(a.city)===json(b.city),nonRailCompileEqualGeometryBase:json(acar)===json(bcar),strippedRailEqualGeometryBase:json(cleanRail(ar))===json(br),trainTimetableEqualGeometryBase:json(trainTimetable(ar))===json(geometryTrains.trainTimetable(br)),fullRailTimetableEqualReviewed:json(railTimetable(ar))===json(reviewedTrains.railTimetable(C.rail)),tramTimetableEqualReviewed:json(tramTimetable(ar))===json(reviewedTrains.tramTimetable(C.rail)),physicalCrossingProtectionEqualReviewed:json(physicalProtection(A))===json(physicalProtection(C)),cityHash:hash(a.city),nonRailHash:hash(acar),trainHash:trainTimetable(ar).hash,routeChanges:0};
if(name.startsWith('munich')){const results=n=>{const p=createRouteProvider(),costs=freeFlowLinkCosts(n);return throughputRequests(n).map(({key,request})=>({key,result:p.route(n,costs,request)}));};const aa=results(A),bb=results(B);row.routeChanges=aa.filter((r,i)=>json(r)!==json(bb[i])).length;row.routeCount=aa.length;}
output.push(row);}
writeFileSync('task147-merge-proof.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
