// Three.js view of Cube Field. Scene construction follows the prototype's buildCube().
import * as THREE from 'three';
import { cubeSpeed, type CubeState } from '@podium/games/src/cube';
import { reducedMotion } from '@podium/games';
import type { Scene3D } from './types';

export type { CubeState };

const CUBES = 70;

export function createCube3D(renderer: THREE.WebGLRenderer): Scene3D<CubeState> {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x1a1f6b);
  sc.fog = new THREE.Fog(0x1a1f6b, 30, 110);
  const cam = new THREE.PerspectiveCamera(66, 480 / 640, 0.1, 200);
  sc.add(new THREE.HemisphereLight(0xdfe4ff, 0x1a1440, 1.05));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(3, 10, 6);
  sc.add(dl);

  const gr = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x10154a }));
  gr.rotation.x = -Math.PI / 2;
  sc.add(gr);
  const grid = new THREE.GridHelper(600, 150, 0x6c5cff, 0x2c3493);
  grid.position.y = 0.02;
  sc.add(grid);

  const cols = [0xff4f81, 0x7af0c5, 0xffd84a, 0xa79bff, 0x7dd3fc];
  const colMats = cols.map((color) => new THREE.MeshLambertMaterial({ color }));
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const cubes: THREE.Mesh[] = [];
  for (let i = 0; i < CUBES; i++) {
    const m = new THREE.Mesh(geo, colMats[i % 5]);
    m.position.y = 1;
    sc.add(m);
    cubes.push(m);
  }

  const ship = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  ship.rotation.x = -Math.PI / 2;
  ship.position.y = 0.7;
  sc.add(ship);

  // Display-only camera juice: the field of view widens with speed and kicks when a cube skims past.
  const prevZ: number[] = new Array(CUBES).fill(-100);
  let kick = 0, last = 0;
  const still = reducedMotion();
  // A glowing tail behind the ship.
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.6, 8), new THREE.MeshBasicMaterial({ color: 0x7af0c5, transparent: true, opacity: 0.45 }));
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0.62, 1.7);
  sc.add(tail);

  return {
    render(s) {
      const now = performance.now();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      for (let i = 0; i < s.cubes.length; i++) {
        const c = s.cubes[i]!;
        if (prevZ[i]! < 1.5 && c.z >= 1.5 && c.z < 8 && Math.abs(c.x - s.x) < 3.2) kick = 1;
        prevZ[i] = c.z;
      }
      kick = Math.max(0, kick - dt * 2.5);
      const v = cubeSpeed(s.t);
      cam.fov = 66 + Math.min(16, (v - 30) * 0.25) + kick * 8;
      cam.updateProjectionMatrix();
      tail.position.x = s.x;
      tail.scale.set(1, 0.5 + Math.min(1, (v - 30) / 50) + Math.random() * 0.15, 1);
      for (let i = 0; i < cubes.length; i++) {
        const mesh = cubes[i]!;
        const c = s.cubes[i];
        mesh.visible = !!c;
        if (c) mesh.position.set(c.x, 1, c.z);
      }
      ship.position.x = s.x;
      ship.rotation.z = -s.vx * 0.03;
      gr.position.x = s.x;
      grid.position.x = Math.round(s.x / 4) * 4;
      grid.position.z = s.dist % 4;
      const j = still ? 0 : kick * 0.16;
      cam.position.set(s.x + (Math.random() - 0.5) * j, 3.4 + (Math.random() - 0.5) * j, 7.5);
      cam.rotation.set(-0.2, 0, -s.vx * 0.012);
      renderer.render(sc, cam);
    },
    dispose() {
      geo.dispose();
      colMats.forEach((m) => m.dispose());
      gr.geometry.dispose();
      (gr.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      ship.geometry.dispose();
      (ship.material as THREE.Material).dispose();
      tail.geometry.dispose();
      (tail.material as THREE.Material).dispose();
    },
  };
}
