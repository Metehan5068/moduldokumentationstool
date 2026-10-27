import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** PDF.js lädt Schriften, CMaps und Decoder ausschließlich aus dem lokalen Bundle. */
function pdfAssets(): Plugin {
  const assets = new Map<string, Buffer>();
  for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    const directory = new URL(`./node_modules/pdfjs-dist/${folder}/`, import.meta.url);
    for (const name of readdirSync(directory)) {
      assets.set(`/${folder}/${name}`, readFileSync(fileURLToPath(new URL(name, directory))));
    }
  }
  return {
    name: 'local-pdf-assets',
    configureServer(server) {
      server.middlewares.use('/pdf-assets', (request, response, next) => {
        const path = request.url?.split('?')[0] ?? '';
        const asset = assets.get(path);
        if (!asset) return next();
        response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        response.end(asset);
      });
    },
    generateBundle() {
      for (const [path, source] of assets) this.emitFile({ type: 'asset', fileName: `pdf-assets${path}`, source });
    },
  };
}

export default defineConfig({
  root: 'src/web',
  plugins: [react(), pdfAssets()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
