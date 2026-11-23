// Picks the Three.js view for a 3D game. 2D games draw through GameDef.draw and get null here.
import type * as THREE from 'three';
import type { GameKey } from '@podium/shared';
import { createCube3D } from './cube';
import { createHopper3D } from './hopper';
import { createTraffic3D } from './traffic';
import type { Scene3D } from './types';

export type { Scene3D } from './types';
export { createCube3D, createHopper3D, createTraffic3D };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createScene3D(key: GameKey, renderer: THREE.WebGLRenderer): Scene3D<any> | null {
  switch (key) {
    case 'traffic':
      return createTraffic3D(renderer);
    case 'cube':
      return createCube3D(renderer);
    case 'hopper':
      return createHopper3D(renderer);
    default:
      return null;
  }
}
