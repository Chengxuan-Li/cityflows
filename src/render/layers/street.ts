import { Container, Graphics, Text } from 'pixi.js';
import { signLabels, type placeStreet } from '../street';

export function drawStreet(
  street: ReturnType<typeof placeStreet>,
  roadGrades: readonly number[] = [],
) {
  const grades = new Map<
    number,
    { grade: number; container: Container; lamps: Graphics; signs: Container }
  >();
  const at = (grade: number) => {
    if (!grades.has(grade)) {
      const container = new Container(),
        lamps = new Graphics(),
        signs = new Container();
      container.addChild(lamps, signs);
      grades.set(grade, { grade, container, lamps, signs });
    }
    return grades.get(grade)!;
  };
  for (const lamp of street.lamps)
    at(lamp.road === undefined ? 0 : (roadGrades[lamp.road] ?? 0))
      .lamps.circle(lamp.pos.x, lamp.pos.y, 0.42)
      .fill(0x64726d)
      .circle(lamp.pos.x, lamp.pos.y, 0.18)
      .fill(0xffefd0);
  for (const sign of street.signs) {
    const face = at(roadGrades[sign.road] ?? 0).signs.addChild(new Container());
    face.position.set(sign.pos.x, sign.pos.y);
    const icon = face.addChild(new Graphics());
    const no = sign.rules.includes('no');
    icon.circle(0, 0, 1.25).fill(no ? 0xc64e45 : 0xfffcf3);
    if (no) icon.rect(-0.85, -0.24, 1.7, 0.48).fill(0xfffcf3);
    else icon.circle(0, 0, 1.08).stroke({ color: 0xc64e45, width: 0.32 });
    const label = sign.rules
      .filter((r) => r !== 'no')
      .map((r) => signLabels[r])
      .join('\n');
    if (label) {
      const text = new Text({
        text: label,
        style: { fontFamily: 'Arial', fontSize: 32, fill: 0x344843, align: 'center' },
      });
      text.scale.set(0.85 / 32);
      text.anchor.set(0.5, 0);
      text.position.y = 1.6;
      icon
        .roundRect(-text.width / 2 - 0.3, 1.45, text.width + 0.6, text.height + 0.3, 0.12)
        .fill(0xfffcf3)
        .stroke({ color: 0x64726d, width: 0.06 });
      face.addChild(text);
    }
  }
  return [...grades.values()];
}
