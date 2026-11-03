#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { greet } from './index.js';

const HELP = `Usage: site-content-bot [options] [name]

Options:
  -h, --help     show this help
  -v, --version  print the version`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
  });
} catch (error) {
  console.error((error as Error).message);
  console.error(HELP);
  process.exit(2);
}

if (parsed.values.help) console.log(HELP);
else if (parsed.values.version) console.log(version());
else console.log(greet(parsed.positionals[0] ?? 'world'));
