import { defineConfig } from 'vite';
import { createRequire } from 'module';
import interfaz from './i18n/es-EC/interfaz.json';

const require = createRequire(import.meta.url);
const kalidokitEsPath = require.resolve('kalidokit/dist/kalidokit.es.js');

export default defineConfig({
  plugins: [
    {
      name: 'visenia-es-ec',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const messages: Record<string, string> = interfaz;
          const entities: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          };
          return html.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, key: string) => {
            if (!Object.hasOwn(messages, key)) throw new Error(`Missing es-EC message: ${key}`);
            return messages[key].replace(/[&<>"']/g, (character) => entities[character]);
          });
        },
      },
    },
  ],
  resolve: {
    alias: {
      kalidokit: kalidokitEsPath,
    },
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: ['**/public/models/**'],
    },
  },
  build: {
    target: 'esnext',
  },
});
