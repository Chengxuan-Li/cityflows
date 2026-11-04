import type { Vec2 } from '../../geo/vec2';

export interface ToolPointer {
  world: Vec2;
  screen: Vec2;
  pointerId: number;
}

export interface MapTool {
  /** Return true to own this gesture; false leaves it to map pan/pick. */
  pointerDown(pointer: ToolPointer): boolean;
  pointerMove(pointer: ToolPointer): void;
  pointerUp(pointer: ToolPointer): void;
  doubleClick?(pointer: ToolPointer): void;
  keyDown?(event: KeyboardEvent): void;
  refresh(): void;
  cancel(): void;
}
