// content-bot.config.mjs: the example loads; each required field missing, a
// wrong kind, a glob with .., an unknown field, a version that is neither a
// known name nor a function: refused with the field named; defaults filled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, DEFAULT_DEPLOY, DEFAULT_EXCLUDE, globToRegExp, loadConfig, validateConfig } from '../dist/index.js';

const work = mkdtempSync(join(tmpdir(), 'content-bot-config-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

const minimal = () => ({
  brand: { name: 'Example site' },
  editable: [{ path: 'src/texts.ts', kind: 'text' }],
  build: { command: 'make site', output: 'out' },
  checks: 'make check',
  urls: { test: 'https://test.example', production: 'https://example.com' },
});

test('the init example loads, with every field', async () => {
  const config = await loadConfig(new URL('../assets/init/content-bot.config.mjs', import.meta.url).pathname);
  assert.equal(config.brand.name, 'Example site');
  assert.equal(config.editable.length, 2);
  assert.equal(config.editable[1].kind, 'svg-text');
  assert.equal(config.version, 'aifactory');
  assert.equal(config.build.output, 'dist');
  assert.deepEqual(config.exclude, DEFAULT_EXCLUDE);
  assert.match(config.layout, /layout, code and styles/);
  assert.deepEqual(config.deploy, { test: 'deploy_linux', production: 'deploy_release' });
});

test('the defaults: mark from the initials, title Content Bot, subtitle from the name, exclude, version aifactory', () => {
  const config = validateConfig(minimal());
  assert.deepEqual(config.brand, { name: 'Example site', mark: 'ES', title: 'Content Bot', subtitle: "The Example site's texts" });
  assert.deepEqual(config.exclude, DEFAULT_EXCLUDE);
  assert.equal(config.version, 'aifactory');
  assert.equal(config.layout, undefined);
  assert.deepEqual(config.editable, [{ path: 'src/texts.ts', kind: 'text' }]);
  assert.deepEqual(config.deploy, DEFAULT_DEPLOY);
  assert.deepEqual(validateConfig({ ...minimal(), deploy: { test: 'build-test', production: 'deploy' } }).deploy, { test: 'build-test', production: 'deploy' });
});

test('each required field missing or wrong is refused with the field named', () => {
  const refuse = (change, pattern) => {
    const input = minimal();
    change(input);
    assert.throws(() => validateConfig(input), (error) => error instanceof ConfigError && pattern.test(error.message), pattern);
  };
  assert.throws(() => validateConfig(null), /default export must be an object/);
  refuse((c) => { delete c.brand; }, /brand must be an object/);
  refuse((c) => { delete c.brand.name; }, /brand\.name must be a non-empty string/);
  refuse((c) => { c.brand.logo = 'x'; }, /brand\.logo is not a field/);
  refuse((c) => { c.editable = []; }, /editable must be a non-empty list/);
  refuse((c) => { c.editable = [{ kind: 'text' }]; }, /editable\[0\] must have either path or glob/);
  refuse((c) => { c.editable = [{ path: 'a', glob: 'b', kind: 'text' }]; }, /editable\[0\] must have either path or glob/);
  refuse((c) => { c.editable = [{ path: 'src/a.ts', kind: 'markdown' }]; }, /editable\[0\]\.kind must be one of text, svg-text/);
  refuse((c) => { c.editable = [{ glob: 'public/../**/*.svg', kind: 'svg-text' }]; }, /editable\[0\]\.glob must be a relative pattern without \.\. segments/);
  refuse((c) => { c.editable = [{ path: '/etc/passwd', kind: 'text' }]; }, /editable\[0\]\.path must be a relative path/);
  refuse((c) => { c.editable = [{ path: 'a', kind: 'text', when: 'x' }]; }, /editable\[0\]\.when is not a field/);
  refuse((c) => { delete c.build; }, /build must be an object/);
  refuse((c) => { delete c.build.output; }, /build\.output must be a non-empty string/);
  refuse((c) => { c.build.output = '../out'; }, /build\.output must be a relative path/);
  refuse((c) => { delete c.checks; }, /checks must be a non-empty string/);
  refuse((c) => { c.exclude = ['../x']; }, /exclude must be a list of relative paths/);
  refuse((c) => { c.version = 'semver'; }, /version must be one of aifactory, patch or a function/);
  refuse((c) => { c.version = 7; }, /version must be one of/);
  refuse((c) => { delete c.urls; }, /urls must be an object/);
  refuse((c) => { c.urls.test = 'test.example'; }, /urls\.test must be an http\(s\) URL/);
  refuse((c) => { c.urls.staging = 'https://x'; }, /urls\.staging is not a field/);
  refuse((c) => { c.testUrl = 'https://x'; }, /testUrl is not a field \(the fields are brand, editable, layout, exclude, build, checks, version, urls, deploy\)/);
  refuse((c) => { c.deploy = 'deploy_linux'; }, /deploy must be an object \{ test, production \}/);
  refuse((c) => { c.deploy = { test: 'a' }; }, /deploy\.production must be a non-empty string/);
  refuse((c) => { c.deploy = { test: 'a', production: 'b', staging: 'c' }; }, /deploy\.staging is not a field \(test, production\)/);
  // A function is a version; a rule on an svg-text entry is dropped (its rule is fixed).
  const fn = async () => '1.2.3';
  assert.equal(validateConfig({ ...minimal(), version: fn }).version, fn);
  assert.equal(validateConfig({ ...minimal(), version: 'patch' }).version, 'patch');
  assert.deepEqual(validateConfig({ ...minimal(), editable: [{ glob: 'public/**/*.svg', kind: 'svg-text', rule: 'ignored' }] }).editable, [{ glob: 'public/**/*.svg', kind: 'svg-text' }]);
});

test('loading: a missing file, a file that does not parse and a file without a default export are named', async () => {
  await assert.rejects(loadConfig(join(work, 'none.mjs')), /none\.mjs does not exist/);
  const broken = join(work, 'broken.mjs');
  writeFileSync(broken, 'export default {\n');
  await assert.rejects(loadConfig(broken), /broken\.mjs could not be loaded/);
  const noDefault = join(work, 'nodefault.mjs');
  writeFileSync(noDefault, 'export const config = {};\n');
  await assert.rejects(loadConfig(noDefault), /nodefault\.mjs has no default export/);
  const good = join(work, 'good.mjs');
  writeFileSync(good, `export default ${JSON.stringify(minimal())};\n`);
  assert.equal((await loadConfig(good)).brand.mark, 'ES');
  // A rewrite is seen on the next load.
  writeFileSync(good, `export default ${JSON.stringify({ ...minimal(), brand: { name: 'Other site' } })};\n`);
  assert.equal((await loadConfig(good)).brand.name, 'Other site');
});

test('globs: * within a segment, ** across segments', () => {
  const svg = globToRegExp('public/**/*.svg');
  assert.ok(svg.test('public/a.svg'));
  assert.ok(svg.test('public/x/y/z.svg'));
  assert.ok(!svg.test('public/a.svg.bak'));
  assert.ok(!svg.test('src/public/a.svg'));
  const one = globToRegExp('content/*.md');
  assert.ok(one.test('content/about.md'));
  assert.ok(!one.test('content/sub/about.md'));
  assert.ok(globToRegExp('docs/**').test('docs/a/b.txt'));
  assert.ok(!globToRegExp('a.b').test('axb'), 'a dot is a dot');
});
