// What the wizard finds out by itself: a pnpm + Vite site on GitHub, a site
// shaped like the website on GitLab, a bare directory, the forms of a remote,
// the container engine from what answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOutput, composeCommand, contentFiles, defaultExec, deployJobs, detect, detectEngine, parseRemote, probePlatform } from '../dist/index.js';

const work = mkdtempSync(join(tmpdir(), 'content-bot-detect-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

const repo = (name, remote, files) => {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '--initial-branch=main', dir]);
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

// The engine: an exec that answers for the commands named.
const execAnswering = (...commands) => async (command, args, options) => {
  if (command === 'git') return defaultExec(command, args, options);
  const line = `${command} ${args.join(' ')}`;
  if (commands.some((known) => line.startsWith(known))) return `${line} ok\n`;
  throw new Error(`${command}: not found`);
};

test('remotes: scp-like, ssh, https, with or without .git, to the https URL and the project; nonsense is null', () => {
  assert.deepEqual(parseRemote('git@github.com:owner/site.git'), { url: 'https://github.com/owner/site.git', host: 'github.com', project: 'owner/site' });
  assert.deepEqual(parseRemote('ssh://git@gitlab.example.com:2222/group/sub/site.git'), { url: 'https://gitlab.example.com/group/sub/site.git', host: 'gitlab.example.com', project: 'group/sub/site' });
  assert.deepEqual(parseRemote('https://gitlab.example.com/group/site'), { url: 'https://gitlab.example.com/group/site.git', host: 'gitlab.example.com', project: 'group/site' });
  assert.deepEqual(parseRemote('https://user:token@github.com/owner/site.git\n'), { url: 'https://github.com/owner/site.git', host: 'github.com', project: 'owner/site' }, 'credentials in the URL are dropped');
  assert.equal(parseRemote(''), null);
  assert.equal(parseRemote('/srv/git/site.git'), null);
  assert.equal(parseRemote('https://github.com/site'), null, 'no owner');
});

test('a pnpm + Vite site on GitHub: pnpm, dist, the content files and the drawings, the two Actions deploy jobs, patch', async () => {
  const dir = repo('vite', 'git@github.com:owner/site.git', {
    'package.json': JSON.stringify({ name: '@owner/site', homepage: 'https://www.example.com', scripts: { build: 'vite build', test: 'vitest run' } }),
    'pnpm-lock.yaml': '',
    '.gitignore': 'node_modules\ndist\n',
    'src/content/texts.ts': 'export const texts = {};\n',
    'src/content/menu.json': '{}',
    'src/content/README.md': 'not content',
    'src/i18n/en.json': '{}',
    'public/img/logo.svg': '<svg/>',
    'public/favicon.ico': '',
    '.github/workflows/deploy.yml': 'name: site\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n  deploy-test:\n    name: Deploy to the test domain\n    runs-on: ubuntu-latest\n  release:\n    name: deploy production\n    runs-on: ubuntu-latest\n',
  });
  const found = await detect(dir, execAnswering('docker compose version'));
  assert.deepEqual(found.remote, { url: 'https://github.com/owner/site.git', host: 'github.com', project: 'owner/site' });
  assert.equal(found.platform, 'github');
  assert.equal(found.platformUrl, '', 'github.com needs no platform URL');
  assert.equal(found.engine, 'docker');
  assert.equal(found.brandName, 'site', 'the scope is dropped');
  assert.equal(found.build.command, 'pnpm --dir "$CLONE" install --frozen-lockfile --prefer-offline >/dev/null && ln -s "$CLONE/node_modules" node_modules && pnpm build >/dev/null');
  assert.equal(found.build.output, 'dist');
  assert.deepEqual(found.editable.map((entry) => `${entry.path ?? entry.glob}:${entry.kind}`), ['src/content/menu.json:text', 'src/content/texts.ts:text', 'src/i18n/**:text', 'public/**/*.svg:svg-text']);
  assert.ok(found.editable[0].rule);
  assert.equal(found.editable[3].rule, undefined, 'a drawing has a fixed rule');
  assert.equal(found.checks, 'pnpm install --frozen-lockfile --prefer-offline >/dev/null && pnpm test');
  assert.deepEqual(found.deploy, { test: 'Deploy to the test domain', production: 'deploy production', found: ['Deploy to the test domain', 'deploy production'] });
  assert.equal(found.version, 'patch');
  assert.equal(found.layout, 'layout, code and styles: src/, public/');
  assert.equal(found.homepage, 'https://www.example.com');
  assert.match(found.botUrl, /^http:\/\/[^/]+:8290$/);
});

test("the website's shape on GitLab: the instance URL, release/site from .gitignore, deploy_linux and deploy_release, aifactory", async () => {
  const dir = repo('website', 'https://gitlab.example.com/devops/website.git', {
    'package.json': JSON.stringify({ name: 'website', scripts: { build: 'tsc' } }),
    'pnpm-lock.yaml': '',
    '.gitignore': '/node_modules\n/release/\n/release/site\n',
    '.gitlab-ci.yml': 'stages: [build, deploy]\nbuild:\n  stage: build\ndeploy_linux:\n  stage: deploy\n  only: [main]\ndeploy_release:\n  stage: deploy\n  only: [tags]\n.deploy_template:\n  script: x\n',
    'requirements/RQ-0001-x.md': '---\nstatus: completed\n---\n',
    'src/content/site-content.ts': 'export const content = {};\n',
    'public/assets/web/models.svg': '<svg/>',
  });
  const found = await detect(dir, execAnswering('podman compose version'));
  assert.equal(found.platform, 'gitlab');
  assert.equal(found.platformUrl, 'https://gitlab.example.com');
  assert.equal(found.engine, 'podman');
  assert.equal(found.build.output, 'release/site');
  assert.deepEqual(found.deploy, { test: 'deploy_linux', production: 'deploy_release', found: ['deploy_linux', 'deploy_release', '.deploy_template'] });
  assert.equal(found.version, 'aifactory');
  assert.equal(found.checks, 'true', 'no test script: true, to be replaced');
  assert.equal(found.homepage, undefined);
});

test('a GitHub Enterprise remote keeps its platform URL; a bare directory finds nothing and throws nothing', async () => {
  const enterprise = await detect(repo('ghe', 'git@github.corp.example:team/site.git', {}), execAnswering());
  assert.equal(enterprise.platform, 'github');
  assert.equal(enterprise.platformUrl, 'https://github.corp.example');
  assert.equal(enterprise.brandName, 'site', 'the repository name without a package.json');
  const bare = join(work, 'bare');
  mkdirSync(bare);
  const found = await detect(bare, execAnswering());
  assert.equal(found.remote, null);
  assert.equal(found.platform, null, 'no remote: nothing proposed');
  assert.equal(found.platformFrom, 'no git remote');
  assert.equal(found.engine, null);
  assert.equal(found.brandName, '');
  assert.equal(found.build.command, undefined);
  assert.equal(found.build.output, 'dist');
  assert.deepEqual(found.editable, []);
  assert.deepEqual(found.deploy, { found: [] });
  assert.equal(found.layout, undefined);
  assert.equal(buildOutput(bare), 'dist');
  mkdirSync(join(bare, 'public'));
  assert.equal(buildOutput(bare), 'dist', 'a public/ that is not ignored is the input, not the output');
  writeFileSync(join(bare, '.gitignore'), 'public/\n');
  assert.equal(buildOutput(bare), 'public', 'an ignored public/ is the output (Hugo)');
  assert.deepEqual(contentFiles(bare), []);
  assert.deepEqual(deployJobs(bare), { found: [] });
});

test('the platform without a token: by the host name, else by what the server answers; nothing answering is null', async () => {
  const none = async () => { throw new Error('no network in this test'); };
  assert.deepEqual(await probePlatform('github.com', none), { platform: 'github', from: "the remote's host github.com" });
  assert.deepEqual(await probePlatform('gitlab.com', none), { platform: 'gitlab', from: "the remote's host gitlab.com" });
  assert.deepEqual(await probePlatform('gitlab.company.example', none), { platform: 'gitlab', from: "the remote's host gitlab.company.example" });
  const server = (routes) => async (url) => {
    const route = routes[new URL(url).pathname];
    if (!route) return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
    return { ok: route.status < 400, status: route.status, headers: new Headers(route.headers ?? {}), json: async () => route.body ?? {} };
  };
  assert.deepEqual(await probePlatform('git.company.example', server({ '/api/v4/version': { status: 401, headers: { 'x-gitlab-meta': '{"cors":"x"}' }, body: { message: '401 Unauthorized' } } })), { platform: 'gitlab', from: 'git.company.example answers as GitLab' });
  assert.deepEqual(await probePlatform('code.company.example', server({ '/api/v3/meta': { status: 200, body: { installed_version: '3.14.0' } } })), { platform: 'github', from: 'code.company.example answers as GitHub Enterprise' });
  assert.deepEqual(await probePlatform('git.company.example', server({})), { platform: null, from: 'git.company.example did not say whether it is GitLab or GitHub' });
  assert.deepEqual(await probePlatform('git.company.example', none), { platform: null, from: 'git.company.example did not say whether it is GitLab or GitHub' });
  // A remote on such a host: the platform from the server, its address proposed.
  const dir = repo('company', 'git@git.company.example:web/site.git', {});
  const found = await detect(dir, execAnswering(), server({ '/api/v4/version': { status: 401, body: { message: '401 Unauthorized' } } }));
  assert.equal(found.platform, 'gitlab');
  assert.equal(found.platformUrl, 'https://git.company.example');
  assert.equal(found.platformFrom, 'git.company.example answers as GitLab');
});

test('the engine: docker first, then podman, then podman-compose; none is null; the compose command of each', async () => {
  assert.equal(await detectEngine(execAnswering('docker compose version', 'podman compose version')), 'docker');
  assert.equal(await detectEngine(execAnswering('podman compose version')), 'podman');
  assert.equal(await detectEngine(execAnswering('podman-compose version')), 'podman-compose');
  assert.equal(await detectEngine(execAnswering()), null);
  assert.deepEqual(composeCommand('docker'), ['docker', 'compose']);
  assert.deepEqual(composeCommand('podman'), ['podman', 'compose']);
  assert.deepEqual(composeCommand('podman-compose'), ['podman-compose']);
});
