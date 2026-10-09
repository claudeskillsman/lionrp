// Signed-distance modelling + surface nets meshing for procedural creatures.
export type V3 = [number, number, number];
export interface Prim {
  kind: 'cone' | 'ell';
  bone: string;
  a: V3; b: V3; ra: number; rb: number; // cone
  c: V3; r: V3; rot: number[] | null; // ellipsoid (rot = row-major 3x3 world->local)
  k: number; // smooth blend radius
  sub: boolean;
  tag: number; // region tag
  noiseAmp: number; noiseFreq: number;
  bmin: V3; bmax: V3;
}
export const TAG = { BODY: 0, LEG: 1, TAIL: 2, HEAD: 3, EAR: 4, MANE: 5, PAW: 6, MUZZLE: 7, NECK: 8 } as const;

export function cone(bone: string, a: V3, b: V3, ra: number, rb: number, k = 0.04, tag: number = TAG.BODY): Prim {
  const pad = Math.max(ra, rb) + k + 0.02;
  return { kind: 'cone', bone, a, b, ra, rb, c: [0, 0, 0], r: [0, 0, 0], rot: null, k, sub: false, tag, noiseAmp: 0, noiseFreq: 0,
    bmin: [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.min(a[2], b[2]) - pad],
    bmax: [Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, Math.max(a[2], b[2]) + pad] };
}
export function ell(bone: string, c: V3, r: V3, k = 0.04, tag: number = TAG.BODY, pitch = 0, yaw = 0, roll = 0): Prim {
  let rot: number[] | null = null;
  if (pitch || yaw || roll) {
    // local = R^T * (p - c); build R = Ry(yaw) * Rx(pitch) * Rz(roll)
    const cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cz = Math.cos(roll), sz = Math.sin(roll);
    const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
    const m = (A: number[], B: number[]) => { const o = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k2 = 0; k2 < 3; k2++) o[i * 3 + j] += A[i * 3 + k2] * B[k2 * 3 + j]; return o; };
    const R = m(m(Ry, Rx), Rz);
    rot = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]; // transpose
  }
  const pad = Math.max(r[0], r[1], r[2]) + k + 0.02;
  return { kind: 'ell', bone, a: [0, 0, 0], b: [0, 0, 0], ra: 0, rb: 0, c, r, rot, k, sub: false, tag, noiseAmp: 0, noiseFreq: 0,
    bmin: [c[0] - pad, c[1] - pad, c[2] - pad], bmax: [c[0] + pad, c[1] + pad, c[2] + pad] };
}

export function primDist(p: Prim, x: number, y: number, z: number): number {
  if (p.kind === 'ell') {
    let px = x - p.c[0], py = y - p.c[1], pz = z - p.c[2];
    if (p.rot) { const R = p.rot; const lx = R[0] * px + R[1] * py + R[2] * pz, ly = R[3] * px + R[4] * py + R[5] * pz, lz = R[6] * px + R[7] * py + R[8] * pz; px = lx; py = ly; pz = lz; }
    const ax = px / p.r[0], ay = py / p.r[1], az = pz / p.r[2];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = px / (p.r[0] * p.r[0]), by = py / (p.r[1] * p.r[1]), bz = pz / (p.r[2] * p.r[2]);
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(p.r[0], p.r[1], p.r[2]);
  }
  // round cone (iq)
  const a = p.a, b = p.b, r1 = p.ra, r2 = p.rb;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
  const xvx = pax * l2 - bax * yy, xvy = pay * l2 - bay * yy, xvz = paz * l2 - baz * yy;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz, y2 = yy * yy * l2, z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}

export interface Field { data: Float32Array; nx: number; ny: number; nz: number; ox: number; oy: number; oz: number; h: number; }

export function buildField(prims: Prim[], h: number, noise3: (x: number, y: number, z: number) => number): Field {
  let mn: V3 = [1e9, 1e9, 1e9], mx: V3 = [-1e9, -1e9, -1e9];
  for (const p of prims) if (!p.sub) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p.bmin[i]); mx[i] = Math.max(mx[i], p.bmax[i]); }
  const ox = mn[0] - h * 2, oy = mn[1] - h * 2, oz = mn[2] - h * 2;
  const nx = Math.ceil((mx[0] - ox) / h) + 3, ny = Math.ceil((mx[1] - oy) / h) + 3, nz = Math.ceil((mx[2] - oz) / h) + 3;
  const data = new Float32Array(nx * ny * nz).fill(1);
  const apply = (p: Prim) => {
    const i0 = Math.max(0, Math.floor((p.bmin[0] - ox) / h)), i1 = Math.min(nx - 1, Math.ceil((p.bmax[0] - ox) / h));
    const j0 = Math.max(0, Math.floor((p.bmin[1] - oy) / h)), j1 = Math.min(ny - 1, Math.ceil((p.bmax[1] - oy) / h));
    const k0 = Math.max(0, Math.floor((p.bmin[2] - oz) / h)), k1 = Math.min(nz - 1, Math.ceil((p.bmax[2] - oz) / h));
    const kk = p.k;
    for (let k = k0; k <= k1; k++) {
      const z = oz + k * h;
      for (let j = j0; j <= j1; j++) {
        const y = oy + j * h;
        let idx = (k * ny + j) * nx + i0;
        for (let i = i0; i <= i1; i++, idx++) {
          const x = ox + i * h;
          let d = primDist(p, x, y, z);
          if (p.noiseAmp > 0 && d < p.noiseAmp * 2 + kk) d += noise3(x * p.noiseFreq, y * p.noiseFreq, z * p.noiseFreq) * p.noiseAmp;
          const f = data[idx];
          if (p.sub) {
            // smooth subtraction
            const hh = Math.max(kk - Math.abs(-d - f), 0) / kk;
            data[idx] = Math.max(f, -d) + hh * hh * kk * 0.25;
          } else {
            const hh = Math.max(kk - Math.abs(d - f), 0) / kk;
            data[idx] = Math.min(f, d) - hh * hh * kk * 0.25;
          }
        }
      }
    }
  };
  for (const p of prims) if (!p.sub) apply(p);
  for (const p of prims) if (p.sub) apply(p);
  return { data, nx, ny, nz, ox, oy, oz, h };
}

export function sampleField(f: Field, x: number, y: number, z: number): number {
  const fx = Math.min(Math.max((x - f.ox) / f.h, 0), f.nx - 1.001), fy = Math.min(Math.max((y - f.oy) / f.h, 0), f.ny - 1.001), fz = Math.min(Math.max((z - f.oz) / f.h, 0), f.nz - 1.001);
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k;
  const nx = f.nx, nxy = f.nx * f.ny, d = f.data, o = k * nxy + j * nx + i;
  const c00 = d[o] + (d[o + 1] - d[o]) * tx, c10 = d[o + nx] + (d[o + nx + 1] - d[o + nx]) * tx;
  const c01 = d[o + nxy] + (d[o + nxy + 1] - d[o + nxy]) * tx, c11 = d[o + nxy + nx] + (d[o + nxy + nx + 1] - d[o + nxy + nx]) * tx;
  const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
  return c0 + (c1 - c0) * tz;
}

/** Surface nets: returns positions, normals, indices. */
export function surfaceNets(f: Field) {
  const { data, nx, ny, nz, ox, oy, oz, h } = f;
  const cellIndex = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  const nxy = nx * ny;
  const offs = [0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1];
  const cbits = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const o = k * nxy + j * nx + i;
    let mask = 0;
    for (let c = 0; c < 8; c++) { corner[c] = data[o + offs[c]]; if (corner[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const da = corner[a], db = corner[b];
      if ((da < 0) === (db < 0)) continue;
      const t = da / (da - db);
      const A = cbits[a], B = cbits[b];
      sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; n++;
    }
    cellIndex[o] = pos.length / 3;
    pos.push(ox + (i + sx / n) * h, oy + (j + sy / n) * h, oz + (k + sz / n) * h);
  }
  const idx: number[] = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const o = k * nxy + j * nx + i;
    const d0 = data[o];
    const inside = d0 < 0;
    // x-edge (o -> o+1): cells sharing it: (i, j-1..j, k-1..k)
    if (i < nx - 1 && (data[o + 1] < 0) !== inside) {
      const a = cellIndex[o - nx - nxy], b = cellIndex[o - nxy], c = cellIndex[o], d = cellIndex[o - nx];
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) { if (inside) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); }
    }
    if (j < ny - 1 && (data[o + nx] < 0) !== inside) {
      const a = cellIndex[o - 1 - nxy], b = cellIndex[o - nxy], c = cellIndex[o], d = cellIndex[o - 1];
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) { if (inside) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); }
    }
    if (k < nz - 1 && (data[o + nxy] < 0) !== inside) {
      const a = cellIndex[o - 1 - nx], b = cellIndex[o - nx], c = cellIndex[o], d = cellIndex[o - 1];
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) { if (inside) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); }
    }
  }
  const P = new Float32Array(pos);
  // relax + reproject onto the isosurface for smoother, more even triangles
  relax(P, idx, f, 2);
  const N = new Float32Array(P.length);
  const e = h * 0.75;
  for (let v = 0; v < P.length; v += 3) {
    const x = P[v], y = P[v + 1], z = P[v + 2];
    const gx = sampleField(f, x + e, y, z) - sampleField(f, x - e, y, z);
    const gy = sampleField(f, x, y + e, z) - sampleField(f, x, y - e, z);
    const gz = sampleField(f, x, y, z + e) - sampleField(f, x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    N[v] = gx / l; N[v + 1] = gy / l; N[v + 2] = gz / l;
  }
  return { positions: P, normals: N, indices: idx };
}

function relax(P: Float32Array, idx: number[], f: Field, iters: number) {
  const n = P.length / 3;
  const acc = new Float32Array(P.length), cnt = new Uint16Array(n);
  for (let it = 0; it < iters; it++) {
    acc.fill(0); cnt.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        acc[u * 3] += P[v * 3]; acc[u * 3 + 1] += P[v * 3 + 1]; acc[u * 3 + 2] += P[v * 3 + 2]; cnt[u]++;
      }
    }
    const e = f.h * 0.5;
    for (let v = 0; v < n; v++) {
      if (!cnt[v]) continue;
      let x = P[v * 3] * 0.5 + acc[v * 3] / cnt[v] * 0.5, y = P[v * 3 + 1] * 0.5 + acc[v * 3 + 1] / cnt[v] * 0.5, z = P[v * 3 + 2] * 0.5 + acc[v * 3 + 2] / cnt[v] * 0.5;
      for (let r = 0; r < 2; r++) {
        const d = sampleField(f, x, y, z);
        const gx = sampleField(f, x + e, y, z) - sampleField(f, x - e, y, z), gy = sampleField(f, x, y + e, z) - sampleField(f, x, y - e, z), gz = sampleField(f, x, y, z + e) - sampleField(f, x, y, z - e);
        const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e);
        if (g2 < 1e-6) break;
        const s = d / g2 / (2 * e);
        x -= gx * s; y -= gy * s; z -= gz * s;
      }
      P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    }
  }
}
