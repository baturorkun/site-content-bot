import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cli = (...args) => spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

test('--version prints the package version', () => {
  const result = cli('--version');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), version);
});

test('--help exits 0 and an unknown option exits 2', () => {
  assert.equal(cli('--help').status, 0);
  assert.equal(cli('--no-such-option').status, 2);
});

test('a name is greeted', () => {
  assert.equal(cli('Ada').stdout.trim(), 'Hello, Ada!');
});
