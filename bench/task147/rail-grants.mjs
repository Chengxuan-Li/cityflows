import fs from 'node:fs';
const variant=process.argv[2];
let p='src/sim/engine.ts',s=fs.readFileSync(p,'utf8');
const marker='        const railStop = railCrossings?.hold(id) ?? Infinity;';
if(!s.includes(marker))throw Error('rail');
s=s.replace(marker,marker+`
        const heldBeforeJunction = !!lane && railStop <= lane.lengthM + 1e-6;
        ${variant==='release-stopped'?'if(heldBeforeJunction && granted && vehicles.speed[id]!<0.1 && position<=railStop+1e-6) intersections.release(id);':''}`);
const request='          requester === -1 &&\n          !granted &&';
if(!s.includes(request))throw Error('request marker');
s=s.replace(request,'          requester === -1 &&\n          !heldBeforeJunction &&\n          !granted &&');
fs.writeFileSync(p,s);
