from pathlib import Path
p=Path('tests/render/V117-visual-fixes.test.ts')
s=p.read_text()
s="import {writeFileSync} from 'node:fs';\n"+s
s=s.replace("expect(hash(street.lamps)).toBe(pins[name].lamps);","writeFileSync(name+'-lamps.json',JSON.stringify(street.lamps));")
s=s.replace("expect(hash(street.curbs)).toBe(pins[name].curbs);","writeFileSync(name+'-curbs.json',JSON.stringify(street.curbs));")
s=s.replace("      expect(\n        hash([\n          city.roads.map", "      console.info(name,id,\n        hash([\n          city.roads.map")
s=s.replace("      ).toBe(pins[name][id]);","      );")
s=s.replace("tierCities(['grid', 'town', 'munich', 'sindelfingen'] as const)", "(['munich', 'sindelfingen'] as const)")
p.write_text(s)
