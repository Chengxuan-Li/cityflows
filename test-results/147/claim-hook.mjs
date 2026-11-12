import {registerHooks} from 'node:module';
globalThis.__claim147={made:{},released:{},first:[],expired:[]};
registerHooks({load(url,ctx,next){const r=next(url,ctx);let s=String(r.source);if(url.endsWith('/src/sim/compact-claims.ts')){
s=s.replace('  function progress(id: number, path: Path)',`  console.log('CLAIM_CHOICES147',JSON.stringify(candidates.flat().reduce((out,p)=>(out[p.facility]=(out[p.facility]??0)+1,out),{})));
  function progress(id: number, path: Path)`);
s=s.replace('    claims.set(id, { path, route, prefix, clear, expires: timeS + duration });',`    const stats=globalThis.__claim147;stats.made[path.facility]=(stats.made[path.facility]??0)+1;if(stats.first.length<8)stats.first.push({timeS,id,entry:entry.id,exit:exit.id,duration,horizon});
    claims.set(id, { path, route, prefix, clear, expires: timeS + duration });`);
s=s.replace('        )\n          claims.delete(id);',`        ) {const stats=globalThis.__claim147;const reason=p>=claim.clear?'clear':nowS>=claim.expires?'expired':'cancel';stats.released[reason]=(stats.released[reason]??0)+1;if(reason==='expired'&&stats.expired.length<8)stats.expired.push({timeS,id,position:p,clear:claim.clear,lane:vehicles.lane[id]});claims.delete(id);}`);
return {...r,source:s};}
if(url.endsWith('/test-results/147/counter.ts')||url.endsWith('/test-results/physical-footprints/probe.ts'))return {...r,source:s+`\nconsole.log('CLAIM_STATS147',JSON.stringify(globalThis.__claim147));\n`};return r;}});
