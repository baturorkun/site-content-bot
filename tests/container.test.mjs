// The container commands against a fake engine (a Runner that records each
// command and answers by its shape): start (up, the health wait, the check,
// the login at a terminal or its command without one, the address), an
// unhealthy start, stop, logs, status, update (the tag rewritten, build: and
// another image refused, a bad version), login, podman and podman-compose,
// no init, no engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContainerError, login, logs, readSite, start, status, stop, update } from '../dist/index.js';

const work = mkdtempSync(join(tmpdir(), 'content-bot-container-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const COMPOSE = readFileSync('assets/init/compose.yaml', 'utf8').replace('{{version}}', '0.5.0');

let sites = 0;
const site = ({ env = {}, compose = COMPOSE } = {}) => {
  const dir = join(work, `site-${++sites}`);
  mkdirSync(join(dir, 'tools/content-bot'), { recursive: true });
  writeFileSync(join(dir, 'tools/content-bot/compose.yaml'), compose);
  const values = { CONTENT_BOT_ENGINE: 'docker', CONTENT_BOT_URL: 'http://bot.example:8290', ...env };
  writeFileSync(join(dir, 'tools/content-bot/.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  return dir;
};

const LOGGED_IN = 'ok   the language model is claude: claude-cli (subscription)\nok   claude answers (the claude CLI, logged in): model claude-opus-5-5\n';
const NOT_LOGGED_IN = 'ok   the language model is claude: claude-cli (subscription)\nFAIL claude answers (the claude CLI, logged in): Claude is not logged in in the container: run `claude` in it\n';

// The engine: health answers from a list, check answers from a list, the rest succeeds.
const engine = ({ health = ['starting', 'healthy'], checks = [LOGGED_IN], state = 'running', fail = {} } = {}) => {
  const calls = [];
  const run = async (command, args, { cwd, interactive = false }) => {
    const line = [command, ...args].join(' ');
    calls.push({ line, cwd, interactive });
    for (const [part, result] of Object.entries(fail)) if (line.includes(part)) return { code: 1, stdout: '', stderr: result };
    if (args[0] === 'inspect' && args[2] === '{{.State.Health.Status}}') return { code: 0, stdout: `${health.length > 1 ? health.shift() : health[0]}\n`, stderr: '' };
    if (args[0] === 'inspect' && args[2] === '{{.State.Status}}') return state ? { code: 0, stdout: `${state}\n`, stderr: '' } : { code: 1, stdout: '', stderr: 'no such container' };
    if (args.includes('check')) { const answer = checks.length > 1 ? checks.shift() : checks[0]; return { code: /^FAIL/m.test(answer) ? 1 : 0, stdout: answer, stderr: '' }; }
    if (args.includes('logs')) return { code: 0, stdout: 'site-content-bot: listening\nError: the clone failed\n', stderr: '' };
    if (args.includes('ps')) return { code: 0, stdout: 'NAME STATUS\nsite-content-bot Up 2 minutes (healthy)\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, run, lines: () => calls.map((call) => call.line) };
};
const io = (fake, extra = {}) => { const out = []; return { out, io: { out: (line) => out.push(line), run: fake.run, terminal: false, sleep: async () => {}, intervalMs: 1, timeoutMs: 50, ...extra } }; };

test('start: compose up in tools/content-bot, healthy, checked, the address; each command printed first', async () => {
  const dir = site();
  const fake = engine();
  const { out, io: options } = io(fake);
  assert.equal(await start(await readSite(dir, fake.run), options), 0);
  assert.deepEqual(fake.lines(), [
    'docker compose -f compose.yaml up -d',
    'docker inspect -f {{.State.Health.Status}} site-content-bot',
    'docker inspect -f {{.State.Health.Status}} site-content-bot',
    'docker exec site-content-bot site-content-bot check',
  ]);
  assert.equal(fake.calls[0].cwd, join(dir, 'tools/content-bot'), 'compose reads the .env beside it');
  assert.ok(out.includes('$ docker compose -f compose.yaml up -d'));
  assert.ok(out.includes('$ docker exec site-content-bot site-content-bot check'));
  assert.ok(out.includes('  ok   claude answers (the claude CLI, logged in): model claude-opus-5-5'));
  assert.equal(out.at(-1), 'The bot is at http://bot.example:8290');
});

test('start: not logged in, without a terminal: the login command and exit 1; at a terminal: the login, interactively, and the check again', async () => {
  const fake = engine({ checks: [NOT_LOGGED_IN] });
  const without = io(fake);
  assert.equal(await start(await readSite(site(), fake.run), without.io), 1);
  assert.ok(without.out.includes('the claude CLI is not logged in; at a terminal run: docker exec -it site-content-bot claude'));

  const codexFake = engine({ checks: [NOT_LOGGED_IN.replace(/claude/g, 'codex').replace('Claude', 'Codex')] });
  const codexOut = io(codexFake);
  assert.equal(await start(await readSite(site({ env: { CONTENT_BOT_LLM: 'codex', CONTENT_BOT_CONTAINER: 'site-b' } }), codexFake.run), codexOut.io), 1);
  assert.ok(codexOut.out.includes('the codex CLI is not logged in; at a terminal run: docker exec -it site-b codex login --device-auth'));

  const atTerminal = engine({ checks: [NOT_LOGGED_IN, LOGGED_IN] });
  const terminal = io(atTerminal, { terminal: true });
  assert.equal(await start(await readSite(site(), atTerminal.run), terminal.io), 0);
  const loginCall = atTerminal.calls.find((call) => call.line === 'docker exec -it site-content-bot claude');
  assert.ok(loginCall?.interactive, 'the person types /login');
  assert.ok(terminal.out.includes('The claude CLI opens: type /login, follow it, then /exit.'));
  assert.equal(atTerminal.lines().filter((line) => line.endsWith('site-content-bot check')).length, 2, 'checked again after the login');
  assert.equal(terminal.out.at(-1), 'The bot is at http://bot.example:8290');
});

test('start: unhealthy, or never healthy, is exit 1 with the last log lines; another failing check leaves it running', async () => {
  for (const health of [['starting', 'unhealthy'], ['starting']]) {
    const fake = engine({ health });
    const { out, io: options } = io(fake);
    assert.equal(await start(await readSite(site(), fake.run), options), 1, health.join());
    assert.ok(out.includes('site-content-bot is not healthy; its last lines:'));
    assert.ok(out.includes('  Error: the clone failed'));
  }
  const failing = engine({ checks: ['FAIL CONTENT_BOT_TOKEN is set\n'] });
  const { out, io: options } = io(failing);
  assert.equal(await start(await readSite(site(), failing.run), options), 1);
  assert.ok(out.includes('the check failed (above); the container is left running. `site-content-bot logs` shows more.'));
  assert.ok(!failing.lines().some((line) => line.includes('exec -it')), 'no login for another failure');
  const up = engine({ fail: { 'up -d': 'pull access denied' } });
  await assert.rejects(start(await readSite(site(), up.run), io(up).io), /compose up failed \(exit 1\): pull access denied/);
});

test('stop, logs, status: down keeps the volume; logs streams; status runs the check when it runs and says start when not', async () => {
  const dir = site();
  const fake = engine();
  const one = io(fake);
  assert.equal(await stop(await readSite(dir, fake.run), one.io), 0);
  assert.equal(fake.lines()[0], 'docker compose -f compose.yaml down');
  assert.ok(one.out.at(-1).includes('its volume (the clone, the copies, the logins) is kept'));
  assert.equal(await logs(await readSite(dir, fake.run), one.io, { follow: true }), 0);
  assert.deepEqual(fake.calls.at(-1), { line: 'docker compose -f compose.yaml logs --follow --tail 200', cwd: join(dir, 'tools/content-bot'), interactive: true });
  assert.equal(await status(await readSite(dir, fake.run), one.io), 0);
  assert.ok(one.out.includes('  site-content-bot Up 2 minutes (healthy)'));
  assert.ok(fake.lines().at(-1).endsWith('site-content-bot check'));
  const stopped = engine({ state: 'exited' });
  const two = io(stopped);
  assert.equal(await status(await readSite(dir, stopped.run), two.io), 1);
  assert.ok(two.out.includes('site-content-bot is not running (exited): site-content-bot start'));
});

test('update: the image tag to --to or this version, pulled, started; build:, another image and a bad version refused', async () => {
  const dir = site();
  const fake = engine();
  const { out, io: options } = io(fake);
  assert.equal(await update(await readSite(dir, fake.run), options, { to: 'v0.6.1', version: '0.5.0' }), 0);
  const compose = readFileSync(join(dir, 'tools/content-bot/compose.yaml'), 'utf8');
  assert.match(compose, /image: \$\{CONTENT_BOT_IMAGE:-ghcr\.io\/baturorkun\/site-content-bot:0\.6\.1\}/);
  assert.ok(out.includes('compose.yaml: ghcr.io/baturorkun/site-content-bot:0.5.0 → 0.6.1'));
  assert.deepEqual(fake.lines().slice(0, 2), ['docker compose -f compose.yaml pull', 'docker compose -f compose.yaml up -d']);
  const again = io(engine());
  await update(await readSite(dir, fake.run), again.io, { version: '0.6.1' });
  assert.ok(again.out.includes('compose.yaml already names ghcr.io/baturorkun/site-content-bot:0.6.1'));
  await assert.rejects(update(await readSite(dir, fake.run), io(fake).io, { to: 'latest', version: '0.5.0' }), /the version is MAJOR\.MINOR\.PATCH, not "latest"/);
  await assert.rejects(update(await readSite(site({ compose: 'services:\n  content-bot:\n    build: .\n' }), fake.run), io(fake).io, { version: '0.5.0' }), (error) => error instanceof ContainerError && /builds its own image \(build:\)/.test(error.message));
  await assert.rejects(update(await readSite(site({ compose: 'services:\n  content-bot:\n    image: example/mine:1\n' }), fake.run), io(fake).io, { version: '0.5.0' }), /does not name ghcr\.io\/baturorkun\/site-content-bot/);
});

test('login: at a terminal the CLI login and a check; without one refused with the command', async () => {
  const fake = engine();
  const terminal = io(fake, { terminal: true });
  assert.equal(await login(await readSite(site({ env: { CONTENT_BOT_LLM: 'codex' } }), fake.run), terminal.io), 0);
  assert.deepEqual(fake.calls[0], { line: 'docker exec -it site-content-bot codex login --device-auth', cwd: fake.calls[0].cwd, interactive: true });
  assert.ok(terminal.out.includes('codex prints a code and an address: open it in a browser and enter the code.'));
  await assert.rejects(login(await readSite(site(), fake.run), io(fake).io), /the claude CLI is not logged in; at a terminal run: docker exec -it site-content-bot claude/);
});

test('podman uses podman compose and podman exec; podman-compose uses podman-compose and podman exec', async () => {
  for (const [name, composeLine] of [['podman', 'podman compose -f compose.yaml up -d'], ['podman-compose', 'podman-compose -f compose.yaml up -d']]) {
    const fake = engine();
    assert.equal(await start(await readSite(site({ env: { CONTENT_BOT_ENGINE: name } }), fake.run), io(fake).io), 0);
    assert.equal(fake.lines()[0], composeLine);
    assert.equal(fake.lines()[1], 'podman inspect -f {{.State.Health.Status}} site-content-bot');
    assert.equal(fake.lines().at(-1), 'podman exec site-content-bot site-content-bot check');
  }
});

test('readSite: no compose file or no .env is "run init first"; no engine set and none answering is refused; a wrong engine or LLM is named', async () => {
  const bare = join(work, 'bare');
  mkdirSync(bare);
  await assert.rejects(readSite(bare, engine().run), /tools\/content-bot\/compose\.yaml is missing: run site-content-bot init first/);
  const noEnv = site();
  rmSync(join(noEnv, 'tools/content-bot/.env'));
  await assert.rejects(readSite(noEnv, engine().run), /tools\/content-bot\/\.env is missing: run site-content-bot init first/);
  const none = async () => ({ code: 127, stdout: '', stderr: 'not found' });
  await assert.rejects(readSite(site({ env: { CONTENT_BOT_ENGINE: '' } }), none), /no container engine answers: install Docker \(docker compose\) or Podman \(podman compose\)/);
  const detected = engine();
  assert.equal((await readSite(site({ env: { CONTENT_BOT_ENGINE: '' } }), detected.run)).engine, 'docker', 'detected when .env leaves it empty');
  await assert.rejects(readSite(site({ env: { CONTENT_BOT_ENGINE: 'lxc' } }), engine().run), /CONTENT_BOT_ENGINE is "lxc"; it is one of docker, podman, podman-compose/);
  await assert.rejects(readSite(site({ env: { CONTENT_BOT_LLM: 'gpt' } }), engine().run), /CONTENT_BOT_LLM is "gpt"/);
  const named = await readSite(site({ env: { CONTENT_BOT_CONTAINER: 'site-b' } }), engine().run);
  assert.equal(named.container, 'site-b');
});
