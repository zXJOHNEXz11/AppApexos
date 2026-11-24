#!/usr/bin/env node
/**
 * Copia a public/models/human/ los modelos de Human que usa el maestro de rostros
 * (detección, malla, reconocimiento, antispoof y liveness). Se sirven desde la propia
 * app y el Service Worker los precachea: la comparación de rostro funciona sin señal.
 * Se ejecuta solo en `predev` y `prebuild`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// El mapa "exports" del paquete no expone package.json: se parte de su entrada principal.
const src = join(dirname(require.resolve('@vladmandic/human')), '..', 'models');
const dest = join(root, 'public', 'models', 'human');
const MODELS = ['blazeface', 'facemesh', 'faceres', 'antispoof', 'liveness'];

mkdirSync(dest, { recursive: true });
let total = 0;
for (const name of MODELS) {
  for (const ext of ['json', 'bin']) {
    const from = join(src, `${name}.${ext}`);
    const to = join(dest, `${name}.${ext}`);
    if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
    total += statSync(to).size;
  }
}
console.log(`Modelos de rostro listos en public/models/human (${(total / 1048576).toFixed(1)} MB)`);
