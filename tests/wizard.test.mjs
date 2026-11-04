// The wizard with scripted answers on a pnpm site: the files it writes and
// what they hold, a second run proposing what was written, the editable line,
// the token verification with a fake platform, --yes refusing without a
// source, the .env reader and writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultExec, editableFromLine, editableToLine, loadConfig, readEnv, runWizard, verifyToken, writeEnv } from '../dist/index.js';

const work = mkdtempSync(join(tmpdir(), 'content-bot-wizard-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const templates = new URL('../assets/init/', import.meta.url).pathname;

const site = join(work, 'site');
mkdirSync(join(site, 'src/content'), { recursive: true });
mkdirSync(join(site, 'public'), { recursive: true });
execFileSync('git', ['init', '-q', '--initial-branch=main', site]);
execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:owner/site.git'], { cwd: site });
writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'site', scripts: { build: 'vite build', test: 'vitest run' } }));
writeFileSync(join(site, 'pnpm-lock.yaml'), '');
writeFileSync(join(site, '.gitignore'), 'node_modules\ndist\n');
writeFileSync(join(site, 'src/content/texts.ts'), 'export const texts = {};\n');
writeFileSync(join(site, 'public/logo.svg'), '<svg/>');

// Answers by a part of the prompt; anything else takes the proposal (Enter).
const scripted = (answers = {}, { secrets = {} } = {}) => {
  const notes = [];
  const prompts = [];
  // A question asked again and again has no answer here: stop, naming it.
  const guard = (prompt) => { if (prompts.filter((seen) => seen === prompt).length > 5) throw new Error(`asked again and again: ${prompt}`); };
  const pick = (table, prompt) => Object.entries(table).find(([key]) => prompt.includes(key))?.[1];
  return {
    notes,
    prompts,
    ask: {
      async question(prompt, proposal) { prompts.push(prompt); guard(prompt); return pick(answers, prompt) ?? proposal ?? ''; },
      async secret(prompt) { prompts.push(prompt); guard(prompt); return pick(secrets, prompt) ?? ''; },
      note(text) { notes.push(text); },
    },
  };
};
// git runs for real (the remote); of the engines only docker answers, or none.
const exec = async (command, args, options) => { if (command === 'git') return defaultExec(command, args, options); if (command === 'docker' && args[0] === 'compose') return 'Docker Compose version v2\n'; throw new Error('not found'); };
const noEngine = async (command, args, options) => { if (command === 'git') return defaultExec(command, args, options); throw new Error('not found'); };
const verified = [];
const verify = async (input) => { verified.push(input); return ['the project answers: owner/site', 'the token can push', 'git reaches the repository']; };

test('the wizard on a pnpm site: GitHub proposed, the config from the repository, .env with every setting at 0600, .gitignore, the summary', async () => {
  const script = scripted({ 'test domain serves': 'https://test.example.com', 'production serves': 'https://www.example.com', 'Client ID': 'app-id' }, { secrets: { 'Its secret': 'app-secret', 'The token': 'ghp_token' } });
  const result = await runWizard({ dir: site, ask: script.ask, exec, templates, version: '0.3.0', verify });
  assert.deepEqual(result.written, ['content-bot.config.mjs', 'tools/content-bot/Dockerfile', 'tools/content-bot/compose.yaml', 'tools/content-bot/.env', '.gitignore (+ tools/content-bot/.env)']);
  assert.deepEqual(result.kept, []);
  assert.equal(result.engine, 'docker');
  assert.deepEqual(result.warnings, []);
  assert.match(script.prompts[0], /^The platform \(gitlab, github\) \[github\]/, 'the platform is the first question');
  assert.ok(script.notes.includes("The platform: GitHub, from the remote's host github.com."), 'where the proposal comes from');
  assert.ok(script.prompts.findIndex((prompt) => prompt.startsWith('GitHub (empty')) < script.prompts.findIndex((prompt) => prompt.startsWith('The site,')), 'the platform URL right after the platform');

  const config = await loadConfig(join(site, 'content-bot.config.mjs'));
  assert.equal(config.brand.name, 'site');
  assert.deepEqual(config.editable, [{ path: 'src/content/texts.ts', kind: 'text', rule: 'the text inside string literals; never keys, imports, paths or the structure of the file' }, { glob: 'public/**/*.svg', kind: 'svg-text' }]);
  assert.equal(config.build.output, 'dist');
  assert.match(config.build.command, /^pnpm --dir "\$CLONE" install .* && pnpm build >\/dev\/null$/);
  assert.equal(config.checks, 'pnpm install --frozen-lockfile --prefer-offline >/dev/null && pnpm test');
  assert.deepEqual(config.deploy, { test: 'deploy_linux', production: 'deploy_release' }, 'no pipeline file: the defaults');
  assert.equal(config.version, 'patch');
  assert.deepEqual(config.urls, { test: 'https://test.example.com', production: 'https://www.example.com' });
  assert.equal(config.layout, 'layout, code and styles: src/, public/');

  const envFile = join(site, 'tools/content-bot/.env');
  assert.equal((statSync(envFile).mode & 0o777).toString(8), '600');
  const env = readEnv(envFile);
  assert.equal(env.CONTENT_BOT_REPO_URL, 'https://github.com/owner/site.git');
  assert.equal(env.CONTENT_BOT_PLATFORM, 'github');
  assert.equal(env.CONTENT_BOT_PROJECT, 'owner/site');
  assert.equal(env.CONTENT_BOT_TOKEN, 'ghp_token');
  assert.equal(env.CONTENT_BOT_OAUTH_ID, 'app-id');
  assert.equal(env.CONTENT_BOT_OAUTH_SECRET, 'app-secret');
  assert.equal(env.CONTENT_BOT_ENGINE, 'docker');
  assert.equal(env.CONTENT_BOT_LLM, 'claude');
  assert.match(readFileSync(envFile, 'utf8'), /^#CONTENT_BOT_MODEL=claude-opus-5-5$/m, "claude's default model: a comment");
  assert.ok(script.prompts.includes('The language model CLI (claude, codex) [claude]: '));
  assert.ok(script.notes.includes('  docker exec -it site-content-bot claude      # /login once, then /exit'));
  assert.match(env.CONTENT_BOT_URL, /^http:\/\/[^/]+:8290$/);
  assert.equal(env.CONTENT_BOT_HOST_PORT, undefined, 'at its default: a comment');
  assert.match(readFileSync(envFile, 'utf8'), /^#CONTENT_BOT_MIN_ACCESS=30$/m);
  assert.equal(env.CONTENT_BOT_PLATFORM_URL, undefined, 'github.com: empty, a comment');
  assert.match(readFileSync(envFile, 'utf8'), /^#CONTENT_BOT_PLATFORM_URL=$/m);
  assert.match(readFileSync(join(site, '.gitignore'), 'utf8'), /\ntools\/content-bot\/\.env\n$/);
  assert.match(readFileSync(join(site, 'tools/content-bot/Dockerfile'), 'utf8'), /site-content-bot@0\.3\.0/);
  assert.match(readFileSync(join(site, 'tools/content-bot/compose.yaml'), 'utf8'), /\$\{CONTENT_BOT_HOST_PORT:-8290\}:8290/);

  assert.equal(verified.length, 1);
  assert.equal(verified[0].platformName, 'github');
  assert.equal(verified[0].token, 'ghp_token');
  assert.equal(verified[0].url, 'https://github.com');
  assert.ok(script.notes.some((note) => /github\.com\/settings\/developers/.test(note) && /auth\/callback/.test(note)), 'the OAuth App instructions with the callback');
  assert.ok(script.notes.some((note) => note.trim().startsWith('Next: commit content-bot.config.mjs')));
  assert.ok(script.notes.some((note) => /docker compose -f tools\/content-bot\/compose\.yaml up -d --build/.test(note)));
});

test('a second run proposes what was written, keeps the Dockerfile and the compose file, and changes only what is answered', async () => {
  const script = scripted({ 'The site, as the page': 'Example site', 'The bot as the browser': 'https://bot.example.com', 'host port': '9000' });
  const result = await runWizard({ dir: site, ask: script.ask, exec, templates, version: '0.3.0', verify });
  assert.deepEqual(result.kept, ['tools/content-bot/Dockerfile', 'tools/content-bot/compose.yaml']);
  assert.ok(script.prompts.some((prompt) => prompt.includes('[https://test.example.com]')), 'the URL written before is the proposal');
  assert.ok(script.prompts.some((prompt) => prompt.startsWith('Its Client ID') && prompt.includes('[app-id]')));
  assert.ok(script.prompts.some((prompt) => prompt.startsWith('The token') && prompt.includes('[kept]')), 'a secret is kept, not shown');
  const config = await loadConfig(join(site, 'content-bot.config.mjs'));
  assert.equal(config.brand.name, 'Example site');
  assert.equal(config.brand.mark, 'ES', 'the mark follows the new name');
  const env = readEnv(join(site, 'tools/content-bot/.env'));
  assert.equal(env.CONTENT_BOT_URL, 'https://bot.example.com');
  assert.equal(env.CONTENT_BOT_HOST_PORT, '9000', 'a URL without a port asks for the host port');
  assert.equal(env.CONTENT_BOT_TOKEN, 'ghp_token', 'kept');
  assert.equal(env.CONTENT_BOT_OAUTH_SECRET, 'app-secret', 'kept');
  assert.equal(readFileSync(join(site, '.gitignore'), 'utf8').split('tools/content-bot/.env').length, 2, 'the ignore line once');
});

test('the editable line: path:kind entries, a kind from the extension, rules kept for known entries, a wrong kind refused', () => {
  const entries = editableFromLine('src/texts.ts:text, public/**/*.svg:svg-text, docs/*.md', [{ path: 'src/texts.ts', kind: 'text', rule: 'my rule' }]);
  assert.deepEqual(entries, [
    { path: 'src/texts.ts', kind: 'text', rule: 'my rule' },
    { glob: 'public/**/*.svg', kind: 'svg-text' },
    { glob: 'docs/*.md', kind: 'text', rule: 'the text inside string literals; never keys, imports, paths or the structure of the file' },
  ]);
  assert.equal(editableToLine(entries), 'src/texts.ts:text, public/**/*.svg:svg-text, docs/*.md:text');
  assert.equal(editableFromLine('img/a.svg')[0].kind, 'svg-text');
  assert.throws(() => editableFromLine('a.ts:markdown'), /a\.ts:markdown: the kind is text or svg-text/);
});

test('--yes: every proposal taken, what has none from the flags or the environment; a missing one names its flag; a refused token stops', async () => {
  const dir = join(work, 'yes');
  mkdirSync(dir);
  execFileSync('git', ['init', '-q', '--initial-branch=main', dir]);
  execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.example.com/group/site.git'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'site', scripts: { build: 'x' } }));
  writeFileSync(join(dir, 'src.txt'), '');
  const silent = { ask: { async question(p, proposal) { throw new Error(`asked: ${p}`); }, async secret(p) { throw new Error(`asked: ${p}`); }, note() {} } };
  await assert.rejects(runWizard({ dir, ...silent, yes: true, exec, templates, version: '0.3.0', verify }), /--yes needs a proposal for The editable files/);
  const given = { 'test-url': 'https://test.example', 'production-url': 'https://example.com', 'oauth-id': 'id' };
  const env = { CONTENT_BOT_OAUTH_SECRET: 's3', CONTENT_BOT_TOKEN: 'glpat' };
  mkdirSync(join(dir, 'src/content'), { recursive: true });
  writeFileSync(join(dir, 'src/content/texts.json'), '{}');
  await assert.rejects(runWizard({ dir, ...silent, yes: true, given: { 'test-url': 'https://test.example' }, env, exec, templates, version: '0.3.0', verify }), /--yes needs --production-url/);
  await assert.rejects(runWizard({ dir, ...silent, yes: true, given, env: { CONTENT_BOT_TOKEN: 'glpat' }, exec, templates, version: '0.3.0', verify }), /--yes needs --oauth-secret/);
  await assert.rejects(runWizard({ dir, ...silent, yes: true, given, env, exec, templates, version: '0.3.0', verify: async () => { throw new Error('the token lacks the scope api'); } }), /the token was refused: the token lacks the scope api/);
  const result = await runWizard({ dir, ...silent, yes: true, given, env, exec, templates, version: '0.3.0', verify });
  assert.equal(result.settings.CONTENT_BOT_PLATFORM, 'gitlab');
  assert.equal(result.settings.CONTENT_BOT_PLATFORM_URL, 'https://gitlab.example.com');
  assert.equal(result.settings.CONTENT_BOT_TOKEN, 'glpat');
  assert.equal(result.settings.CONTENT_BOT_OAUTH_SECRET, 's3');
  assert.equal(result.config.checks, 'true');
  assert.deepEqual(result.warnings, ["checks is 'true': nothing is checked before a push; put the site's test command there"]);
  assert.ok(existsSync(join(dir, 'tools/content-bot/.env')));
});

test('GitLab: gitlab.com or the own address from the remote; with no remote the platform has no proposal and gitlab.com is the address proposed', async () => {
  const dir = join(work, 'noremote');
  mkdirSync(join(dir, 'src/content'), { recursive: true });
  writeFileSync(join(dir, 'src/content/t.json'), '{}');
  const script = scripted({ 'The platform (gitlab, github)': 'gitlab', 'The repository over HTTP': 'https://gitlab.com/group/site.git', 'The project': 'group/site', 'The site, as the page': 'Site', 'The build command': 'make site', 'test domain': 'https://t.example', 'production serves': 'https://p.example', 'Application ID': 'id' }, { secrets: { 'Its secret': 's', 'The token': 'glpat' } });
  const result = await runWizard({ dir, ask: script.ask, exec, templates, version: '0.3.0', verify });
  assert.equal(script.prompts[0], 'The platform (gitlab, github): ', 'no proposal without a remote');
  assert.ok(script.notes.includes('The platform: no git remote; say which.'));
  assert.ok(script.prompts.includes('The GitLab address (https://gitlab.com or your own) [https://gitlab.com]: '));
  assert.equal(result.settings.CONTENT_BOT_PLATFORM_URL, 'https://gitlab.com');
  const withPodman = scripted({ 'container engine': 'podman', 'Application ID': 'id', 'language model CLI': 'codex' }, { secrets: { 'Its secret': 's', 'The token': 'glpat' } });
  const podman = await runWizard({ dir, ask: withPodman.ask, exec, templates, version: '0.3.0', verify });
  assert.equal(podman.engine, 'podman');
  assert.ok(withPodman.notes.includes('  podman compose -f tools/content-bot/compose.yaml up -d --build'));
  assert.ok(withPodman.notes.some((note) => note.startsWith('  podman exec -it site-content-bot codex login --device-auth')), "the engine's own exec, the chosen CLI's login");
  assert.equal(podman.settings.CONTENT_BOT_LLM, 'codex');
  assert.equal(podman.settings.CONTENT_BOT_MODEL, '', "codex: its own default model");
  assert.ok(withPodman.prompts.includes("The model (empty: codex's default): "), 'no claude model proposed for codex');
  const written = readFileSync(join(dir, 'tools/content-bot/.env'), 'utf8');
  assert.match(written, /^CONTENT_BOT_LLM=codex$/m);
  assert.match(written, /^#CONTENT_BOT_MODEL=$/m);
  assert.ok(script.notes.some((note) => note.includes('https://gitlab.com/groups/group/-/settings/applications')), 'the OAuth page on that address');
});

test('a refused token is asked again; Enter keeps it unverified with a warning; no engine warns and goes on', async () => {
  const dir = join(work, 'retry');
  mkdirSync(join(dir, 'src/content'), { recursive: true });
  execFileSync('git', ['init', '-q', '--initial-branch=main', dir]);
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:o/r.git'], { cwd: dir });
  writeFileSync(join(dir, 'src/content/t.json'), '{}');
  let attempts = 0;
  const flaky = async ({ token }) => { attempts++; if (token !== 'good') throw new Error(`GitHub answered 401 for the repository`); return ['ok']; };
  const retried = scripted({ 'The build command': 'make site', 'test domain': 'https://t.example', 'production serves': 'https://p.example', 'Client ID': 'id' }, { secrets: { 'Its secret': 's', 'The token:': 'bad', 'The token again': 'good' } });
  const one = await runWizard({ dir, ask: retried.ask, exec: noEngine, templates, version: '0.3.0', verify: flaky });
  assert.equal(attempts, 2);
  assert.equal(one.settings.CONTENT_BOT_TOKEN, 'good');
  assert.equal(one.engine, null);
  assert.ok(one.warnings.includes('no container engine answers: install Docker (docker compose) or Podman (podman compose) before starting the bot'));
  assert.ok(retried.notes.some((note) => note.includes('the token was refused: GitHub answered 401 for the repository')));
  assert.ok(retried.notes.some((note) => note.trim().startsWith('podman') === false && note.includes('docker exec -it site-content-bot claude')), 'no engine: the docker commands');
  rmSync(join(dir, 'tools'), { recursive: true });
  const kept = scripted({ 'The build command': 'make site', 'test domain': 'https://t.example', 'production serves': 'https://p.example', 'Client ID': 'id' }, { secrets: { 'Its secret': 's', 'The token:': 'bad', 'The token again': '' } });
  attempts = 0;
  const two = await runWizard({ dir, ask: kept.ask, exec, templates, version: '0.3.0', verify: flaky });
  assert.equal(attempts, 1);
  assert.equal(two.settings.CONTENT_BOT_TOKEN, 'bad');
  assert.ok(two.warnings.some((warning) => warning.startsWith('the token was written unverified: GitHub answered 401')));
});

test('verifyToken: GitLab scopes, GitHub push, the repository through git; each refusal named', async () => {
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const platform = { projectReachable: async () => 'group/site' };
  const gitlab = (scopes) => async (url) => (url.endsWith('/personal_access_tokens/self') ? reply(200, { scopes }) : reply(404, {}));
  const origin = join(work, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  const seed = join(work, 'seed');
  execFileSync('git', ['clone', '-q', origin, seed]);
  writeFileSync(join(seed, 'a'), 'a');
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@example.com', 'commit', '-q', '-am', 'x', '--allow-empty'], { cwd: seed });
  execFileSync('git', ['add', 'a'], { cwd: seed });
  execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@example.com', 'commit', '-q', '-m', 'seed'], { cwd: seed });
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: seed });
  const base = { platform, url: 'https://gitlab.example', project: 'group/site', token: 't', repoUrl: origin };
  assert.deepEqual(await verifyToken({ ...base, platformName: 'gitlab', fetchImpl: gitlab(['api', 'write_repository', 'read_api']) }), ['the project answers: group/site', 'scopes api, write_repository, read_api', 'git reaches the repository']);
  await assert.rejects(verifyToken({ ...base, platformName: 'gitlab', fetchImpl: gitlab(['read_api', 'write_repository']) }), /the token lacks the scope api \(it has read_api, write_repository\)/);
  await assert.rejects(verifyToken({ ...base, platformName: 'gitlab', fetchImpl: gitlab([]) }), /lacks the scopes api, write_repository/);
  assert.match((await verifyToken({ ...base, platformName: 'gitlab', fetchImpl: async () => reply(404, {}) }))[1], /scopes could not be read/);
  await assert.rejects(verifyToken({ ...base, platformName: 'gitlab', fetchImpl: gitlab(['api', 'write_repository']), repoUrl: join(work, 'nowhere.git') }), /does not appear to be a git repository|nowhere|not found/i);
  const github = (permissions) => async () => reply(200, { permissions });
  assert.deepEqual(await verifyToken({ ...base, platformName: 'github', url: 'https://github.com', fetchImpl: github({ pull: true, push: true }) }), ['the project answers: group/site', 'the token can push', 'git reaches the repository']);
  await assert.rejects(verifyToken({ ...base, platformName: 'github', url: 'https://github.com', fetchImpl: github({ pull: true, push: false }) }), /the token cannot push to group\/site \(permissions: pull\)/);
  await assert.rejects(verifyToken({ ...base, platformName: 'github', url: 'https://github.com', fetchImpl: async () => reply(401, {}) }), /GitHub answered 401 for the repository/);
  await assert.rejects(verifyToken({ ...base, platformName: 'github', url: 'https://github.com', platform: { projectReachable: async () => { throw new Error('GitHub answered 404 for the repository group/site'); } }, fetchImpl: github({ push: true }) }), /GitHub answered 404/);
  await assert.rejects(verifyToken({ ...base, platformName: 'gitlab', platform: { projectReachable: async () => { throw new TypeError('fetch failed'); } }, fetchImpl: gitlab(['api']) }), /^Error: https:\/\/gitlab\.example did not answer \(fetch failed\)$/);
});

test('.env: written with quotes where needed, read back; comments and export lines', () => {
  const file = join(work, 'x', 'tools/content-bot/.env');
  writeEnv(file, { CONTENT_BOT_REPO_URL: 'https://x/y.git', CONTENT_BOT_PLATFORM: 'gitlab', CONTENT_BOT_PLATFORM_URL: 'https://x', CONTENT_BOT_PROJECT: 'g/s', CONTENT_BOT_TOKEN: 'a b#c', CONTENT_BOT_URL: 'http://b:8290', CONTENT_BOT_OAUTH_ID: 'i', CONTENT_BOT_OAUTH_SECRET: "s'q", CONTENT_BOT_ENGINE: '', CONTENT_BOT_MIN_ACCESS: '40', CONTENT_BOT_MODEL: 'claude-opus-5-5', CONTENT_BOT_HOST_PORT: '8290' });
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^CONTENT_BOT_TOKEN="a b#c"$/m);
  assert.match(text, /^CONTENT_BOT_MIN_ACCESS=40$/m);
  assert.match(text, /^#CONTENT_BOT_MODEL=claude-opus-5-5$/m);
  assert.match(text, /^#CONTENT_BOT_ENGINE=$/m);
  const back = readEnv(file);
  assert.equal(back.CONTENT_BOT_TOKEN, 'a b#c');
  assert.equal(back.CONTENT_BOT_OAUTH_SECRET, "s'q");
  assert.equal(back.CONTENT_BOT_MODEL, undefined);
  writeFileSync(file, 'export CONTENT_BOT_URL = "http://z"\n# CONTENT_BOT_PROJECT=no\n');
  assert.deepEqual(readEnv(file), { CONTENT_BOT_URL: 'http://z' });
  assert.deepEqual(readEnv(join(work, 'missing.env')), {});
});
