// Three.js view of Traffic Rush. Scene construction follows the prototype's build3() / car3().
import * as THREE from 'three';
import { trafficSpeed, type TrafficState } from '@podium/games/src/traffic';
import { reducedMotion } from '@podium/games';
import type { Scene3D } from './types';

export type { TrafficState };

const POOL = 14;
const LINE_WRAP = 156;
const BUILDING_WRAP = 168;

function car3(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color });
  const d = new THREE.MeshLambertMaterial({ color: 0x10142a });
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 3.6), m);
  b.position.y = 0.6;
  g.add(b);
  const c = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.8), new THREE.MeshLambertMaterial({ color: 0xbfe6ff }));
  c.position.set(0, 1.15, -0.1);
  g.add(c);
  for (const x of [-0.95, 0.95]) {
    for (const z of [-1.2, 1.2]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.7), d);
      w.position.set(x, 0.3, z);
      g.add(w);
    }
  }
  return g;
}

/** Where an object that started at z0 and scrolls with the road is now: it jumps back by `wrap` once past `limit`. */
function scrolled(z0: number, dist: number, limit: number, wrap: number): number {
  const d = limit - (z0 + dist);
  return limit - (((d % wrap) + wrap) % wrap);
}

function disposeScene(scene: THREE.Scene): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry as THREE.BufferGeometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m as THREE.Material);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

export function createTraffic3D(renderer: THREE.WebGLRenderer): Scene3D<TrafficState> {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x3a2a86);
  sc.fog = new THREE.Fog(0x3a2a86, 25, 95);
  const cam = new THREE.PerspectiveCamera(62, 480 / 640, 0.1, 200);
  cam.position.set(0, 6, 9.5);
  cam.lookAt(0, 1, -9);
  sc.add(new THREE.HemisphereLight(0xcfd8ff, 0x1a1440, 1.05));
  const dl = new THREE.DirectionalLight(0xffffff, 0.7);
  dl.position.set(4, 10, 6);
  sc.add(dl);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 400), new THREE.MeshLambertMaterial({ color: 0x232a4f }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = -150;
  sc.add(road);
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(200, 400), new THREE.MeshLambertMaterial({ color: 0x0f3d3a }));
  gr.rotation.x = -Math.PI / 2;
  gr.position.set(0, -0.05, -150);
  sc.add(gr);

  // Lane markings and buildings are scenery: their z is derived from state.dist.
  const lines: { mesh: THREE.Mesh; z0: number }[] = [];
  const lm = new THREE.MeshBasicMaterial({ color: 0xe9edff });
  for (let i = 0; i < 26; i++) {
    for (const x of [-1.5, 1.5]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 2.2), lm);
      l.position.set(x, 0.02, -i * 6);
      sc.add(l);
      lines.push({ mesh: l, z0: -i * 6 });
    }
  }
  const blds: { mesh: THREE.Mesh; z0: number }[] = [];
  const cols = [0x5b4bd6, 0x2a7f86, 0x7dd3fc, 0x8b7bff, 0x3a4a9a];
  for (let i = 0; i < 28; i++) {
    // Cosmetic randomness, chosen once per view.
    const h = 3 + Math.random() * 9;
    const b = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), new THREE.MeshLambertMaterial({ color: cols[i % 5] }));
    b.position.set((i % 2 ? 1 : -1) * (9 + Math.random() * 5), h / 2, -i * 6);
    sc.add(b);
    blds.push({ mesh: b, z0: -i * 6 });
  }

  const me = car3(0x5eead4);
  sc.add(me);
  const pool: THREE.Group[] = [];
  const cc = [0xfb7185, 0xffd84a, 0xff8a3c, 0xe9edff, 0xb48bff];
  for (let i = 0; i < POOL; i++) {
    const c = car3(cc[i % 5]!);
    c.visible = false;
    sc.add(c);
    pool.push(c);
  }

  // Display-only camera juice: the field of view widens with speed and kicks on a near miss.
  const prevZ: number[] = new Array(POOL).fill(-100);
  let kick = 0, last = 0;
  const still = reducedMotion();

  return {
    render(s) {
      const now = performance.now();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      for (let i = 0; i < s.cars.length; i++) {
        const c = s.cars[i]!;
        // A car that just went past in the next lane.
        if (c.on && prevZ[i]! < 1.2 && c.z >= 1.2 && Math.abs(c.x - s.px) < 3.6) kick = 1;
        prevZ[i] = c.on ? c.z : -100;
      }
      kick = Math.max(0, kick - dt * 2.5);
      const v = trafficSpeed(s.t);
      cam.fov = 62 + Math.min(14, (v - 22) * 0.28) + kick * 7;
      cam.updateProjectionMatrix();
      const j = still ? 0 : kick * 0.18;
      cam.position.set((Math.random() - 0.5) * j + s.px * 0.12, 6 + (Math.random() - 0.5) * j, 9.5);
      cam.lookAt(s.px * 0.1, 1, -9);
      const tx = (s.lane - 1) * 3;
      me.position.x = s.px;
      me.rotation.y = (s.px - tx) * 0.12;
      for (const l of lines) l.mesh.position.z = scrolled(l.z0, s.dist, 10, LINE_WRAP);
      for (const b of blds) b.mesh.position.z = scrolled(b.z0, s.dist, 12, BUILDING_WRAP);
      for (let i = 0; i < pool.length; i++) {
        const mesh = pool[i]!;
        const c = s.cars[i];
        mesh.visible = !!c && c.on;
        if (c && c.on) mesh.position.set(c.x, 0, c.z);
      }
      renderer.render(sc, cam);
    },
    dispose() {
      disposeScene(sc);
    },
  };
}
