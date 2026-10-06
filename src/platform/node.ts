// Node.js: the napi engine, model files, Node's own EventEmitter.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';

import { SupersynthError } from '../errors.js';
import { loadNative } from '../native.js';
import { resolveModelFile } from './node-models.js';
import type { Bytes, Platform } from './platform.js';

export { EventEmitter };

/** @internal */
export const platform: Platform = {
  name: 'node',
  async prepare() {
    loadNative();
  },
  createEngine(options) {
    return new (loadNative().SynthEngine)(options);
  },
  locateModel(name, modelsDirectory) {
    const file = resolveModelFile(name, modelsDirectory);
    if (!existsSync(file)) throw new SupersynthError(`Instrument model '${name}' not found at ${file}`);
    return file;
  },
  readModel: (file) => readFileSync(file),
  modelSize: (file) => statSync(file).size,
  async fetchModels(names, modelsDirectory) {
    // read from disk when used: only checked here
    for (const name of names) platform.locateModel(name, modelsDirectory);
  },
  memory: () => totalmem(),
  readFile: (file) => readFileSync(file),
  writeFile: (file, data) => writeFileSync(file, data),
  allocBytes: (n) => Buffer.alloc(n) as Bytes,
  toBytes: (data) => Buffer.from(data as ArrayLike<number>) as Bytes,
  warn(message, code) {
    if (warned.has(code)) return;
    warned.add(code);
    process.emitWarning(message, { code });
  },
};

const warned = new Set<string>();
