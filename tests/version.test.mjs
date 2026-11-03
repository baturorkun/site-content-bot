// The version policies against a seed repository: aifactory with and without a
// completed requirement, patch with and without a release, a function, a
// function returning something that is not a version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Repo, nextVersion, requirementVersion, versionPolicies, versionPolicy } from '../dist/index.js';

const work = mkdtempSync(join(tmpdir(), 'content-bot-version-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

const origin = join(work, 'origin.git');
execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
const seed = join(work, 'seed');
execFileSync('git', ['clone', '-q', origin, seed]);
const git = (...args) => execFileSync('git', ['-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', ...args], { cwd: seed, encoding: 'utf8' }).trim();

// Commit 1: no requirement. Commit 2: RQ-0007 completed at run 2, RQ-0008 ready. Commit 3: RQ-0012 completed, no manifest.
writeFileSync(join(seed, 'package.json'), JSON.stringify({ version: '4.5.6' }));
git('add', '-A');
git('commit', '-q', '-m', 'one');
const ONE = git('rev-parse', 'HEAD');
mkdirSync(join(seed, 'requirements'), { recursive: true });
mkdirSync(join(seed, 'runs/20260101-RQ-0007'), { recursive: true });
writeFileSync(join(seed, 'requirements/RQ-0007-done.md'), '---\nid: RQ-0007\nstatus: completed\ncompletedRunId: "20260101-RQ-0007"\n---\n');
writeFileSync(join(seed, 'runs/20260101-RQ-0007/manifest.json'), JSON.stringify({ steps: [{ retries: 0 }, { retries: 2 }] }));
writeFileSync(join(seed, 'requirements/RQ-0008-open.md'), '---\nid: RQ-0008\nstatus: ready\n---\n');
git('add', '-A');
git('commit', '-q', '-m', 'two');
const TWO = git('rev-parse', 'HEAD');
writeFileSync(join(seed, 'requirements/RQ-0012-done.md'), '---\nid: RQ-0012\nstatus: completed\ncompletedRunId: "20260102-RQ-0012"\n---\n');
git('add', '-A');
git('commit', '-q', '-m', 'three');
const THREE = git('rev-parse', 'HEAD');
git('push', '-q', 'origin', 'HEAD:main');

const repo = new Repo({ dir: join(work, 'clone'), url: origin });
await repo.sync();

test('aifactory: 1.<last completed requirement>.<largest retries of its run>; a ready requirement and a missing manifest do not count', async () => {
  assert.equal(await requirementVersion(ONE, repo), null);
  assert.deepEqual(await requirementVersion(TWO, repo), { version: '1.7.2', requirement: 'RQ-0007', run: 2 });
  assert.deepEqual(await requirementVersion(THREE, repo), { version: '1.12.0', requirement: 'RQ-0012', run: 0 });
  const policy = versionPolicy('aifactory');
  assert.equal(policy, versionPolicies.aifactory);
  assert.equal(await nextVersion(policy, { candidate: ONE, production: null, repo }), 'v1.0.0', 'no completed requirement: 1.0.0');
  assert.equal(await nextVersion(policy, { candidate: TWO, production: { tag: 'v1.0.0', commit: ONE }, repo }), 'v1.7.2');
  assert.equal(policy.label, '1.<last requirement>.<its run id>');
  assert.equal(typeof policy.status, 'function');
});

test("patch: production's tag with the patch raised; 1.0.0 without a release", async () => {
  const policy = versionPolicy('patch');
  assert.equal(await nextVersion(policy, { candidate: THREE, production: null, repo }), 'v1.0.0');
  assert.equal(await nextVersion(policy, { candidate: THREE, production: { tag: 'v2.3.9', commit: ONE }, repo }), 'v2.3.10');
  assert.equal(await nextVersion(policy, { candidate: THREE, production: { tag: 'release-1', commit: ONE }, repo }), 'v1.0.0', 'a tag that is not a version starts over');
  assert.equal(policy.status, undefined);
});

test("a function: the site's own rule reads the candidate commit; its answer must be MAJOR.MINOR.PATCH", async () => {
  const seen = [];
  const policy = versionPolicy(async ({ candidate, production, read }) => {
    seen.push({ candidate, production });
    return JSON.parse(await read('package.json')).version;
  });
  assert.equal(await nextVersion(policy, { candidate: THREE, production: { tag: 'v1.0.0', commit: ONE }, repo }), 'v4.5.6');
  assert.deepEqual(seen, [{ candidate: THREE, production: { tag: 'v1.0.0', commit: ONE } }]);
  assert.equal(await nextVersion(versionPolicy(async ({ read }) => String((await read('missing.json')) === undefined ? '0.0.1' : 'x')), { candidate: THREE, production: null, repo }), 'v0.0.1', 'a missing file reads as undefined');
  await assert.rejects(nextVersion(versionPolicy(() => 'v1.2.3'), { candidate: THREE, production: null, repo }), /the site's version rule returned "v1\.2\.3", not MAJOR\.MINOR\.PATCH/);
  await assert.rejects(nextVersion(versionPolicy(() => 7), { candidate: THREE, production: null, repo }), /returned 7, not MAJOR\.MINOR\.PATCH/);
  assert.match(policy.label, /the site's own rule/);
});
