import { World } from './worldgen';
self.onmessage = () => {
  const w = new World();
  w.generate((f) => (self as any).postMessage({ progress: f }));
  (self as any).postMessage({ heights: w.heights, biomeA: w.biomeA, biomeB: w.biomeB }, [w.heights.buffer, w.biomeA.buffer, w.biomeB.buffer]);
};
