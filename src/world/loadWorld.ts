import { World } from './worldgen';
import WorldWorker from './worldWorker?worker&inline';
export function loadWorld(onProgress?: (f: number) => void): Promise<World> {
  return new Promise((resolve) => {
    try {
      const worker = new WorldWorker();
      worker.onmessage = (e) => {
        if (e.data.progress !== undefined) { onProgress?.(e.data.progress); return; }
        const w = new World();
        w.heights = e.data.heights; w.biomeA = e.data.biomeA; w.biomeB = e.data.biomeB;
        worker.terminate();
        resolve(w);
      };
      worker.onerror = () => { worker.terminate(); const w = new World(); w.generate(onProgress); resolve(w); };
      worker.postMessage(0);
    } catch {
      const w = new World(); w.generate(onProgress); resolve(w);
    }
  });
}
