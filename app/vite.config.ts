import { defineConfig } from 'vite';
import { createRequire } from 'module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import interfaz from './i18n/es-EC/interfaz.json';

const require = createRequire(import.meta.url);
const kalidokitEsPath = require.resolve('kalidokit/dist/kalidokit.es.js');

export default defineConfig({
  plugins: [
    {
      name: 'visenia-offline',
      apply: 'build',
      closeBundle() {
        const dist = resolve(import.meta.dirname, 'dist');
        const files = readdirSync(dist, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name !== 'sw.js')
          .map((entry) => resolve(entry.parentPath, entry.name))
          .sort();
        const hash = createHash('sha256');
        for (const file of files) hash.update(file).update(readFileSync(file));
        const paths = files.map((file) => '/' + file.slice(dist.length + 1).replaceAll('\\', '/'));
        const worker = resolve(dist, 'sw.js');
        writeFileSync(
          worker,
          `self.__VISENIA_CACHE = "visenia-${hash.digest('hex').slice(0, 16)}";\n` +
            `self.__VISENIA_PRECACHE = ${JSON.stringify(paths)};\n` +
            readFileSync(worker, 'utf8')
        );
      },
    },
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
    host: '127.0.0.1',
    watch: {
      ignored: ['**/public/models/**'],
    },
  },
  build: {
    target: 'esnext',
  },
});
