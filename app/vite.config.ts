import { defineConfig } from 'vite';

export default defineConfig({
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
