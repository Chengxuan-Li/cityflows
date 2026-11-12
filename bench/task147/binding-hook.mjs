import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/src/sim/rail-crossings.ts'))return result;let s=String(result.source);
s=s.replace('  const rail = city.rail;', '  let probeTimeS=startS, probeBest, probeTails=[]; const probeSeen=new Set();\n  const rail = city.rail;');
s=s.replace('    step(timeS: number) {','    step(timeS: number) {probeTimeS=timeS;');
s=s.replace('    hold(id: number) {','    hold(id: number) {probeBest=undefined;probeTails=[];');
s=s.replace('            )\n              blocked = true;',`            ) {blocked=true;probeTails.push({f,segment,offset,tail,tailFront:offset+vehicles.position[tail]!,tailRear:offset+vehicles.position[tail]!-length(tail),tailSpeed:vehicles.speed[tail],near,end});}`);
s=s.replace('          best = at;','          best = at; probeBest={f,stop:at,near,end,position};');
s=s.replace('          best = stop;','          best = stop; probeBest={f,stop,near,end,position};');
s=s.replace('    binding(id: number, binding: boolean) {',`    binding(id: number, binding: boolean) {
      const key=probeBest?.f+':'+vehicles.lane[id]!;
      if(binding && probeBest && states[probeBest.f]===0 && vehicles.speed[id]!<.1 && Math.abs(vehicles.position[id]!-probeBest.stop)<.5 && !probeSeen.has(key) && probeTails.some(t=>t.f===probeBest.f && t.tailSpeed>1 && t.tailRear<t.near)) {
        probeSeen.add(key);console.log('BIND147',JSON.stringify({time:probeTimeS,id,...probeBest,field:vehicles.lane[id],tails:probeTails.filter(t=>t.f===probeBest.f),path:segments.map((field,index)=>({field,id:field<0?city.movements[-field-1]!.id:city.lanes[field]!.id,offset:offsets[index],length:segmentLength(field),red:field<0?red(-field-1):undefined,cars:(()=>{const cars=[];for(let h=vehicles.first(field);h!==-1;h=vehicles.next[h]!)cars.push({id:h,front:vehicles.position[h],length:length(h),speed:vehicles.speed[h],grant:grants?.[h]});return cars;})()}))}));
      }
`);
return {...result,source:s};}});
