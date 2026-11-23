// Three.js view of Road Hopper. Scene construction follows the prototype's buildHop() and DEF.hopper.mk() / place().
import * as THREE from 'three';
import type { HopperRow, HopperState } from '@podium/games/src/hopper';
import type { Scene3D } from './types';

export type { HopperState };

const CAR_COLOURS = [0xff4f81, 0xffd84a, 0x7af0c5, 0xa79bff, 0xff8a3c, 0x7dd3fc];

interface RowView {
  /** The state row this was built from; a cheap identity check before comparing signatures. */
  row: HopperRow;
  sig: string;
  group: THREE.Group;
  /** One group per row item (car or log), in item order. */
  items: THREE.Group[];
}

/** Everything about a row that decides its meshes. Item x is left out: it only moves the meshes. */
function signature(row: HopperRow): string {
  return `${row.r}|${row.type}|${row.dir}|${row.speed}|${row.trees.join(',')}|${row.items.map((it) => it.len).join(',')}`;
}

/** Repeatable cosmetic choices (far trees, tree heights, car colours) for a row, so a row always looks the same. */
function cosmetic(sig: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sig.length; i++) h = Math.imul(h ^ sig.charCodeAt(i), 0x01000193);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) (o.geometry as THREE.BufferGeometry).dispose();
  });
}

export function createHopper3D(renderer: THREE.WebGLRenderer): Scene3D<HopperState> {
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x9fe3ff);
  sc.fog = new THREE.Fog(0x9fe3ff, 48, 84);
  const cam = new THREE.PerspectiveCamera(40, 480 / 640, 0.1, 200);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8fb070, 0.72));
  const dl = new THREE.DirectionalLight(0xffffff, 0.42);
  dl.position.set(-6, 12, 8);
  sc.add(dl);

  const mats = new Map<number, THREE.MeshLambertMaterial>();
  const M = (c: number): THREE.MeshLambertMaterial => {
    let m = mats.get(c);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: c });
      mats.set(c, m);
    }
    return m;
  };
  const B = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c));
    m.position.set(x, y, z);
    return m;
  };

  const pl = new THREE.Group();
  pl.add(
    B(1, 0.9, 1.1, 0xffffff, 0, 0.8, 0),
    B(0.8, 0.7, 0.7, 0xffffff, 0, 1.5, -0.35),
    B(0.3, 0.2, 0.35, 0xff8a1f, 0, 1.42, -0.85),
    B(0.25, 0.3, 0.45, 0xff3d5a, 0, 1.95, -0.3),
    B(0.2, 0.5, 0.7, 0xdfe3f2, -0.6, 0.85, 0),
    B(0.2, 0.5, 0.7, 0xdfe3f2, 0.6, 0.85, 0),
  );
  for (const x of [-0.28, 0.28]) pl.add(B(0.2, 0.36, 0.2, 0xff8a1f, x, 0.18, 0), B(0.13, 0.13, 0.13, 0x15151f, x * 1.45, 1.6, -0.62));
  sc.add(pl);

  const views = new Map<number, RowView>();

  function buildRow(row: HopperRow, sig: string): RowView {
    const r = row.r;
    const rand = cosmetic(sig);
    const g = new THREE.Group();
    g.position.z = -r * 2;
    const items: THREE.Group[] = [];

    if (row.type === 'grass') {
      g.add(B(30, 0.6, 2, r % 2 ? 0x86dc62 : 0x79d056, 0, -0.3, 0));
      for (let c = -7; c <= 7; c++) {
        // Trees beyond column 4 are out of reach: scenery only. The nearer ones come from the state.
        const far = Math.abs(c) > 4;
        if (far ? rand() < 0.6 : row.trees.includes(c)) {
          const h = 1.3 + rand() * 1.2;
          g.add(B(0.5, 1, 0.5, 0x8a5a2e, c * 2, 0.5, 0), B(1.4, h, 1.4, far ? 0x2f9a52 : 0x38b060, c * 2, 1 + h / 2, 0));
        }
      }
    } else if (row.type === 'road') {
      g.add(B(30, 0.5, 2, 0x3b4058, 0, -0.36, 0));
      for (let x = -14; x <= 14; x += 4) g.add(B(1.2, 0.02, 0.12, 0xe8ecff, x, -0.1, 0.98));
      for (const it of row.items) {
        const len = it.len;
        const c = CAR_COLOURS[Math.floor(rand() * 6)]!;
        const m = new THREE.Group();
        m.add(
          B(len, 0.8, 1.3, c, 0, 0.45, 0),
          B(len * 0.5, 0.6, 1.15, 0xf3f5ff, row.dir * -len * 0.1, 1.1, 0),
          B(len * 0.9, 0.3, 1.4, 0x1b1d2e, 0, 0.12, 0),
        );
        g.add(m);
        items.push(m);
      }
    } else {
      g.add(B(30, 0.4, 2, 0x3aa6ff, 0, -0.5, 0));
      for (const it of row.items) {
        const len = it.len;
        const m = new THREE.Group();
        m.add(B(len, 0.5, 1.4, 0x9a6234, 0, -0.2, 0), B(len * 0.8, 0.1, 1, 0xb87a48, 0, 0.08, 0));
        g.add(m);
        items.push(m);
      }
    }
    sc.add(g);
    return { row, sig, group: g, items };
  }

  function dropRow(r: number, v: RowView): void {
    sc.remove(v.group);
    disposeGeometries(v.group);
    views.delete(r);
  }

  /** Makes the row groups in the scene match state.rows, building and freeing only what changed. */
  function syncRows(s: HopperState): void {
    const first = s.rows[0];
    const lo = first ? first.r : 0;
    const hi = lo + s.rows.length;
    views.forEach((v, r) => {
      if (r < lo || r >= hi) dropRow(r, v);
    });
    for (const row of s.rows) {
      let v = views.get(row.r);
      if (v && v.row !== row) {
        // A different object: a new run, or a copy of the state. Rebuild only if the row itself differs.
        const sig = signature(row);
        if (sig === v.sig) v.row = row;
        else {
          dropRow(row.r, v);
          v = undefined;
        }
      }
      if (!v) {
        v = buildRow(row, signature(row));
        views.set(row.r, v);
      }
      for (let i = 0; i < v.items.length; i++) v.items[i]!.position.x = row.items[i]!.x;
    }
  }

  return {
    render(s) {
      syncRows(s);
      const hop = s.hop;
      // Hop arc: the same height the logic uses for its car check.
      const y = hop ? Math.sin(Math.PI * hop.t) * 0.9 : 0;
      pl.position.set(s.x, y, -(hop ? hop.fz + (hop.tz - hop.fz) * hop.t : s.row) * 2);
      pl.rotation.y = s.face;
      pl.scale.set(1, hop ? 1 + 0.25 * Math.sin(Math.PI * hop.t) : 1, 1);
      const cx = s.x * 0.4;
      cam.position.set(cx + 9, 23, -s.cam + 15);
      cam.lookAt(cx, 0, -s.cam - 3.6);
      renderer.render(sc, cam);
    },
    dispose() {
      views.forEach((v, r) => dropRow(r, v));
      sc.remove(pl);
      disposeGeometries(pl);
      mats.forEach((m) => m.dispose());
      mats.clear();
    },
  };
}
