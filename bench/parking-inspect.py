from pathlib import Path
p = Path("src/sim/engine.ts")
source = p.read_text()
anchor = "...parking.detail(id, time()),"
assert source.count(anchor) == 1
p.write_text(source.replace(anchor, anchor + "\n      debugDestinationConnector: vehicles.destination[id],\n      debugParkingMotionConnector: parking.motion(id)?.connector ?? null,"))
