import fs from 'node:fs';
const p='src/sim/rail-crossings.ts';let s=fs.readFileSync(p,'utf8');
const marker='  function publish() {';
if(!s.includes(marker))throw Error(marker);
s=s.replace(marker,`  const phaseAudit={protected:0,warningLead:0,inside:0,tailClear:0,heldForRailOrRoad:0,leadHeld:0,insideHeld:0,roadOccupied:0,nominal:0};
  (globalThis as any).__phase147=phaseAudit;
  function publish() {`);
const marker2='    for (let f = 0; f < states.length; f++)\n      railReady';
if(!s.includes(marker2))throw Error(marker2);
s=s.replace(marker2,`    if(states[2]!==CROSSING_OPEN){
        phaseAudit.protected++; if(occupied[2])phaseAudit.roadOccupied++;
        let lead=false, inside=false, tail=false, held=false, leadHeld=false, insideHeld=false;
        for(const sv of services)for(const e of events[table.departures[sv.departure]!.route]!){
          if(e.facility!==2 || sv.ageS<e.enterS-e.warningS || sv.ageS>e.exitS+1)continue;
          if(sv.ageS<e.enterS){lead=true;leadHeld||=sv.held;}else if(sv.ageS<=e.exitS){inside=true;insideHeld||=sv.held;}else tail=true;
          held||=sv.held;
        }
        if(lead)phaseAudit.warningLead++;if(inside)phaseAudit.inside++;if(tail)phaseAudit.tailClear++;if(held)phaseAudit.heldForRailOrRoad++;if(leadHeld)phaseAudit.leadHeld++;if(insideHeld)phaseAudit.insideHeld++;
     }
    for (let f = 0; f < states.length; f++)
      railReady`);
fs.writeFileSync(p,s);
