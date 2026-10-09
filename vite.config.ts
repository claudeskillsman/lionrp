import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
// SINGLE=1 builds one self-contained index.html (used for deployment); the default build is a normal multi-file app.
const single = !!process.env.SINGLE;
export default defineConfig({
  plugins: single ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, outDir: single ? 'dist-single' : 'dist', copyPublicDir: !single },
  worker: { format: 'es' },
  server: { host: true },
});
