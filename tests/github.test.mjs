// GitHub as the platform, against a fake GitHub: the API's address, the OAuth
// login and the collaborator roles on the bot's scale, the state of a commit
// from its Actions run and the deploy job, the latest Release, the newest
// green main run with the deploy job, a Release made and one refused, the
// repository answering the token; and the server with GitHub: the page and
// /api/me say GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiBase, createApp, createPlatform, githubAccessName, githubPlatform, platformOf, ROLE_LEVEL, validateConfig } from '../dist/index.js';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

// A GitHub: the OAuth token, the user and their e-mails, the collaborator's
// role, the runs and their jobs, the releases, the repository.
const fakeGitHub = ({ role = 'write', emails, runs = {}, jobs = {}, latest = { tag_name: 'v1.0.0' }, releaseStatus = 201, url = 'https://github.com' } = {}) => {
  const calls = [];
  const fetchImpl = async (target, init = {}) => {
    calls.push({ url: target, init });
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    const path = target.replace(/^https?:\/\/[^/]+/, '');
    if (path === '/login/oauth/access_token') return init.body.get('code') === 'good-code' ? reply(200, { access_token: 'user-token' }) : reply(200, { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
    if (path === '/user' || path === '/api/v3/user') return reply(200, { id: 7, login: 'ayse', name: 'Ayşe Yılmaz' });
    if (path.endsWith('/user/emails')) return reply(200, emails ?? [{ email: 'old@example.com', primary: false, verified: true }, { email: 'ayse@example.com', primary: true, verified: true }]);
    if (path.includes('/collaborators/ayse/permission')) return role === 'none' ? reply(404, { message: 'Not Found' }) : reply(200, { permission: role === 'maintain' ? 'write' : role, role_name: role });
    const run = path.match(/\/actions\/runs\?(.*)$/);
    if (run) {
      const query = new URLSearchParams(run[1]);
      const key = query.get('head_sha') ?? `${query.get('branch')}${query.get('status') ? `:${query.get('status')}` : ''}`;
      return reply(200, { workflow_runs: runs[key] ?? [] });
    }
    const runJobs = path.match(/\/actions\/runs\/(\d+)\/jobs/);
    if (runJobs) return reply(200, { jobs: jobs[runJobs[1]] ?? [] });
    if (path.endsWith('/releases/latest')) return latest ? reply(200, latest) : reply(404, { message: 'Not Found' });
    if (path.match(/\/commits\/v[\d.]+$/)) return reply(200, { sha: SHA });
    if (path.endsWith('/releases') && init.method === 'POST') return releaseStatus === 201 ? reply(201, { tag_name: JSON.parse(init.body).tag_name, html_url: 'https://github.com/owner/site/releases/tag/x' }) : reply(releaseStatus, { message: 'Validation Failed', errors: [{ resource: 'Release', code: 'custom', message: 'Tag protected by a ruleset' }] });
    if (path.endsWith('/repos/owner/site')) return reply(200, { full_name: 'owner/site' });
    return reply(404, { message: `no such route ${path}` });
  };
  const platform = githubPlatform({ url, project: 'owner/site', token: 'bot-token', clientId: 'app-id', secret: 'app-secret', redirectUri: 'http://bot.example/auth/callback', fetchImpl });
  return { platform, calls };
};

test('the API: api.github.com for github.com, /api/v3 on an Enterprise server; the platform from the name or the host', () => {
  assert.equal(apiBase('https://github.com'), 'https://api.github.com');
  assert.equal(apiBase('https://github.com/'), 'https://api.github.com');
  assert.equal(apiBase('https://github.example.com'), 'https://github.example.com/api/v3');
  assert.deepEqual(platformOf('github', 'https://gitlab.example/g/s.git'), { platform: 'github', from: 'CONTENT_BOT_PLATFORM' });
  assert.deepEqual(platformOf(undefined, 'https://github.com/o/r.git'), { platform: 'github', from: 'the repository host github.com' });
  assert.deepEqual(platformOf(undefined, 'https://github.corp.example/o/r.git'), { platform: 'github', from: 'the repository host github.corp.example' });
  assert.deepEqual(platformOf('', 'https://gitlab.example/g/s.git'), { platform: 'gitlab', from: 'the repository host gitlab.example' });
  assert.deepEqual(platformOf(undefined, 'nonsense'), { platform: 'gitlab', from: 'the repository host (none)' });
  assert.throws(() => platformOf('bitbucket', ''), /CONTENT_BOT_PLATFORM is "bitbucket"; it is one of gitlab, github/);
  assert.equal(createPlatform('github', { url: 'https://github.com', project: 'o/r', token: 't', clientId: 'a', secret: 'b', redirectUri: 'http://x/auth/callback' }).name, 'GitHub');
  assert.equal(createPlatform('gitlab', { url: 'https://gitlab.example', project: 'g/s', token: 't', clientId: 'a', secret: 'b', redirectUri: 'http://x/auth/callback' }).name, 'GitLab');
});

test('the roles: read and triage 20, write 30, maintain 40, admin 50; the names of the levels', () => {
  assert.deepEqual(ROLE_LEVEL, { read: 20, triage: 20, write: 30, maintain: 40, admin: 50 });
  assert.equal(githubAccessName(30), 'write');
  assert.equal(githubAccessName(40), 'maintain');
  assert.equal(githubAccessName(50), 'admin');
  assert.equal(githubAccessName(35), 'maintain', 'the next role up');
  assert.equal(githubAccessName(60), 'level 60');
});

test('login: the OAuth App, the primary verified e-mail, the role decides the access; triage and strangers are refused, naming the write role', async () => {
  const { platform, calls } = fakeGitHub();
  const { state, location } = platform.auth.start();
  const target = new URL(location);
  assert.equal(`${target.origin}${target.pathname}`, 'https://github.com/login/oauth/authorize');
  assert.deepEqual(Object.fromEntries(target.searchParams), { client_id: 'app-id', redirect_uri: 'http://bot.example/auth/callback', state, scope: 'read:user user:email' });
  await assert.rejects(platform.auth.finish({ code: 'good-code', state, cookieState: 'other' }), /did not start here/);
  const again = platform.auth.start();
  assert.deepEqual(await platform.auth.finish({ code: 'good-code', state: again.state, cookieState: again.state }), { name: 'Ayşe Yılmaz', email: 'ayse@example.com', username: 'ayse', accessLevel: 30 });
  const token = calls.find((call) => call.url.endsWith('/login/oauth/access_token'));
  assert.equal(token.init.body.get('client_secret'), 'app-secret');
  assert.equal(token.init.headers.Accept, 'application/json');
  assert.equal(calls.find((call) => call.url.endsWith('/user')).init.headers.Authorization, 'Bearer user-token', "the user with the person's token");
  const permission = calls.find((call) => call.url.includes('/permission'));
  assert.equal(permission.url, 'https://api.github.com/repos/owner/site/collaborators/ayse/permission');
  assert.equal(permission.init.headers.Authorization, 'Bearer bot-token', "the role with the bot's token");

  const bad = platform.auth.start();
  await assert.rejects(platform.auth.finish({ code: 'bad-code', state: bad.state, cookieState: bad.state }), /GitHub refused the login: The code passed is incorrect or expired\./);

  for (const [options, refusal, level] of [
    [{ role: 'maintain' }, null, 40],
    [{ role: 'admin' }, null, 50],
    [{ role: 'triage' }, /Ayşe Yılmaz does not have the write role \(or above\) on owner\/site on GitHub; ask an admin of the repository\./],
    [{ role: 'read' }, /does not have the write role/],
    [{ role: 'none' }, /does not have the write role/],
    [{ emails: [{ email: 'x@example.com', primary: true, verified: false }] }, /The GitHub account ayse has no verified e-mail\./],
  ]) {
    const other = fakeGitHub(options).platform;
    const begun = other.auth.start();
    const finish = other.auth.finish({ code: 'good-code', state: begun.state, cookieState: begun.state });
    if (refusal) await assert.rejects(finish, refusal, JSON.stringify(options));
    else assert.equal((await finish).accessLevel, level);
  }
  const enterprise = fakeGitHub({ url: 'https://github.example.com' });
  const begun = enterprise.platform.auth.start();
  assert.match(begun.location, /^https:\/\/github\.example\.com\/login\/oauth\/authorize\?/);
  await enterprise.platform.auth.finish({ code: 'good-code', state: begun.state, cookieState: begun.state });
  assert.ok(enterprise.calls.some((call) => call.url === 'https://github.example.com/api/v3/user'), 'the Enterprise API under /api/v3');
  assert.equal(enterprise.platform.host, 'github.example.com');
});

test('deploy state: no run is waiting; the deploy job decides deployed, failed or running; a failed run is failed; a tag by its branch', async () => {
  const runs = {
    [SHA]: [{ id: 1, conclusion: null, status: 'in_progress', html_url: 'https://github.com/owner/site/actions/runs/1' }],
    [OTHER]: [{ id: 2, conclusion: 'success', html_url: 'https://github.com/owner/site/actions/runs/2' }],
    ['c'.repeat(40)]: [{ id: 3, conclusion: 'failure', html_url: 'https://github.com/owner/site/actions/runs/3' }],
    'v1.2.3': [{ id: 4, conclusion: 'success', html_url: 'https://github.com/owner/site/actions/runs/4' }],
  };
  const jobs = {
    1: [{ name: 'build', conclusion: 'success' }, { name: 'deploy_linux', conclusion: null, status: 'in_progress' }],
    2: [{ name: 'deploy_linux', conclusion: 'success' }],
    3: [{ name: 'deploy_linux', conclusion: 'cancelled' }],
    4: [{ name: 'deploy_release', conclusion: 'success' }],
  };
  const { platform, calls } = fakeGitHub({ runs, jobs });
  assert.deepEqual(await platform.deployState({ sha: 'd'.repeat(40), job: 'deploy_linux' }), { state: 'waiting' });
  assert.deepEqual(await platform.deployState({ sha: SHA, job: 'deploy_linux' }), { state: 'running', pipeline: 'https://github.com/owner/site/actions/runs/1' });
  assert.deepEqual(await platform.deployState({ sha: OTHER, job: 'deploy_linux' }), { state: 'deployed', pipeline: 'https://github.com/owner/site/actions/runs/2' });
  assert.deepEqual(await platform.deployState({ sha: OTHER, job: 'deploy_other' }), { state: 'running', pipeline: 'https://github.com/owner/site/actions/runs/2' }, 'a green run without the job is still on its way');
  assert.deepEqual(await platform.deployState({ sha: 'c'.repeat(40), job: 'deploy_linux' }), { state: 'failed', pipeline: 'https://github.com/owner/site/actions/runs/3' });
  assert.deepEqual(await platform.deployState({ ref: 'v1.2.3', job: 'deploy_release' }), { state: 'deployed', pipeline: 'https://github.com/owner/site/actions/runs/4' });
  assert.ok(calls.some((call) => call.url === 'https://api.github.com/repos/owner/site/actions/runs?branch=v1.2.3&per_page=1'), 'a tag is listed by branch');
  assert.ok(calls.some((call) => call.url === `https://api.github.com/repos/owner/site/actions/runs?head_sha=${SHA}&per_page=1`));
  assert.equal(calls[0].init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepEqual(await githubPlatform({ url: '', project: '', token: '', clientId: '', secret: '', redirectUri: '' }).deployState({ sha: SHA, job: 'x' }), { state: 'unknown' });
});

test('the latest release and its commit; none is null; the newest green main run that has the deploy job; a release made and one refused', async () => {
  const runs = {
    'main:success': [
      { id: 10, head_sha: 'e'.repeat(40), html_url: 'https://github.com/owner/site/actions/runs/10' },
      { id: 11, head_sha: 'f'.repeat(40), html_url: 'https://github.com/owner/site/actions/runs/11' },
    ],
  };
  const jobs = { 10: [{ name: 'lint', conclusion: 'success' }], 11: [{ name: 'deploy_linux', conclusion: 'success' }] };
  const { platform, calls } = fakeGitHub({ runs, jobs });
  assert.deepEqual(await platform.latestRelease(), { tag: 'v1.0.0', commit: SHA });
  assert.equal(await fakeGitHub({ latest: null }).platform.latestRelease(), null);
  assert.deepEqual(await platform.lastGreenMain('deploy_linux'), { sha: 'f'.repeat(40), pipeline: 'https://github.com/owner/site/actions/runs/11' }, 'the lint-only run does not count');
  assert.equal(await platform.lastGreenMain('deploy_other'), null);
  assert.ok(calls.some((call) => call.url === 'https://api.github.com/repos/owner/site/actions/runs?branch=main&status=success&per_page=10'));

  assert.deepEqual(await platform.createRelease({ tag: 'v1.1.0', ref: SHA, name: 'v1.1.0', description: 'Changes' }), { tag: 'v1.1.0', url: 'https://github.com/owner/site/releases/tag/x' });
  const made = calls.find((call) => call.init.method === 'POST' && call.url.endsWith('/releases'));
  assert.deepEqual(JSON.parse(made.init.body), { tag_name: 'v1.1.0', target_commitish: SHA, name: 'v1.1.0', body: 'Changes' });
  assert.equal(made.init.headers.Authorization, 'Bearer bot-token');
  await assert.rejects(fakeGitHub({ releaseStatus: 422 }).platform.createRelease({ tag: 'v1.1.0', ref: SHA, name: 'v1.1.0', description: '' }), /GitHub refused the release \(422\): Validation Failed; Tag protected by a ruleset/);
  assert.equal(await platform.projectReachable(), 'owner/site');
  await assert.rejects(githubPlatform({ url: 'https://github.com', project: 'owner/other', token: 't', clientId: '', secret: '', redirectUri: '', fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) }).projectReachable(), /GitHub answered 404 for the repository owner\/other/);
});

test('the server with GitHub: the page and /api/me say GitHub; the login goes to GitHub and a writer comes in', async () => {
  const { platform } = fakeGitHub();
  const config = validateConfig({
    brand: { name: 'Example site' },
    editable: [{ path: 'texts.json', kind: 'text' }],
    build: { command: 'true', output: 'out' },
    checks: 'true',
    urls: { test: 'https://test.example', production: 'https://example.com' },
  });
  const bot = { policy: { label: 'patch' } };
  const login = { platform: platform.name, host: platform.host, project: 'owner/site', access: platform.accessName(30) };
  const server = createApp({ auth: platform.auth, bot, deploy: async () => ({ state: 'unknown' }), config, llm: { provider: 'claude-cli (subscription)', model: 'claude-opus-5-5' }, login });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers = {}) => fetch(`${base}${path}`, { headers, redirect: 'manual' });
  try {
    const page = await (await get('/')).text();
    assert.match(page, /href="\/auth\/login">Log in with GitHub</);
    assert.match(page, /With your GitHub account \(github\.com\)\. Members of the owner\/site project with write access or above can come in\./);
    assert.match(page, /title="The GitHub Release production serves"/);
    assert.match(page, /production changes only with a GitHub Release/);
    assert.doesNotMatch(page, /GitLab|\{\{\w+\}\}/, 'nothing says GitLab, every placeholder is filled');

    const start = await get('/auth/login');
    assert.match(start.headers.get('location'), /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const done = await get(`/auth/callback?code=good-code&state=${state}`, { cookie: start.headers.get('set-cookie').split(';')[0] });
    assert.equal(done.headers.get('location'), '/');
    const cookie = done.headers.getSetCookie().find((entry) => entry.startsWith('content_bot_session=')).split(';')[0];
    const me = await (await get('/api/me', { cookie })).json();
    assert.equal(me.platform, 'GitHub');
    assert.deepEqual(me.user, { name: 'Ayşe Yılmaz', email: 'ayse@example.com', username: 'ayse', accessLevel: 30 });
    const cancelled = await get('/auth/callback?error=access_denied');
    assert.equal(decodeURIComponent(cancelled.headers.get('location')), '/?login_error=GitHub said: access_denied');
  } finally {
    server.close();
  }
});
