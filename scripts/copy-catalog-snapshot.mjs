// tsc does not copy JSON imports' sources; ship the catalog snapshot with the build.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const source = path.join('src', 'core', 'catalog', 'agent-catalog.json');
const target = path.join('dist', 'core', 'catalog', 'agent-catalog.json');
mkdirSync(path.dirname(target), { recursive: true });
cpSync(source, target);
console.log(`copied ${source} -> ${target}`);
