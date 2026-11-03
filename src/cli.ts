#!/usr/bin/env node
// The bin: site-content-bot <command>. The commands are in commands.ts, so a
// test can call them without starting anything.
import { main } from './commands.js';

main(process.argv.slice(2)).then((code) => { if (code >= 0) process.exit(code); });
