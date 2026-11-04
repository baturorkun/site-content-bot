// package.json as npm publishes it (RQ-0006, the lessons of agents-diet's
// first release): npm 11 drops a bin whose path starts with ./ from the
// registry manifest, and publish.yml stops when repository does not name this
// repository (npm provenance checks it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('bin paths are relative without ./ or / and point at built files', () => {
  const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin;
  assert.ok(bins && Object.keys(bins).length > 0, 'package.json has a bin');
  assert.deepEqual(Object.keys(bins), ['site-content-bot']);
  for (const [name, path] of Object.entries(bins)) {
    assert.doesNotMatch(path, /^\.?\//, `bin[${name}] "${path}" starts with ./ or /`);
    assert.ok(existsSync(path), `bin[${name}] "${path}" is not built`);
  }
});

test('repository names this repository, as publish.yml checks it; access is public', () => {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  assert.match(url ?? '', /github\.com[/:]baturorkun\/site-content-bot(\.git)?$/, 'repository.url');
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.match(pkg.homepage ?? '', /^https:\/\/github\.com\/baturorkun\/site-content-bot/);
});

test('files: the built code and the assets, nothing of the sources, the tests or the image', () => {
  for (const entry of ['dist', 'assets']) assert.ok(pkg.files.includes(entry), entry);
  for (const entry of ['src', 'tests', 'docker', 'runs', 'handoffs', '.env']) assert.ok(!pkg.files.some((file) => file === entry || file.startsWith(`${entry}/`)), entry);
});
