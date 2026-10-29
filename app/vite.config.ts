import { defineConfig } from 'vite';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const kalidokitEsPath = require.resolve('kalidokit/dist/kalidokit.es.js');

export default defineConfig({
  resolve: {
    alias: {
      kalidokit: kalidokitEsPath
    }
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: ['**/public/models/**']
    }
  },
  build: {
    target: 'esnext'
  }
});
