// The container on the host (RQ-0005): start, stop, logs, status, update and
// login, run in the site's clone. The compose file (tools/content-bot/
// compose.yaml, written by init) names the published image; the .env beside
// it holds the settings and the engine the wizard found. Every command is
// printed before it runs; a Runner the tests replace runs them.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeCommand, detectEngine, ENGINES, type Engine, type Exec } from './detect.js';
import { llmOf, type LlmName } from './llm.js';
import { readEnv } from './wizard.js';

export const IMAGE = 'ghcr.io/baturorkun/site-content-bot';
export const DEFAULT_CONTAINER = 'site-content-bot';
const TOOLS = 'tools/content-bot';
const VERSION = /^\d+\.\d+\.\d+$/;
const IMAGE_LINE = /(image:\s*\$\{CONTENT_BOT_IMAGE:-ghcr\.io\/baturorkun\/site-content-bot:)([^}\s]+)(\})/;

export class ContainerError extends Error {}

export interface RunResult { code: number; stdout: string; stderr: string }
// interactive: the person's terminal (stdin, stdout, stderr), nothing captured.
export type Runner = (command: string, args: string[], options: { cwd: string; interactive?: boolean }) => Promise<RunResult>;

export const defaultRunner: Runner = (command, args, { cwd, interactive = false }) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk; });
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => reject(new ContainerError(`${command} could not be started: ${error.message}`)));
  child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
});

// exec and inspect: docker's own for docker, podman's for both podman engines.
export const runner = (engine: Engine): string => (engine === 'docker' ? 'docker' : 'podman');

export interface SiteContainer {
  dir: string;
  tools: string;
  composeFile: string;
  engine: Engine;
  container: string;
  url: string;
  llm: LlmName;
}

const execOf = (run: Runner): Exec => async (command, args, options = {}) => {
  const result = await run(command, args, { cwd: options.cwd ?? process.cwd() });
  if (result.code !== 0) throw new Error(result.stderr || `${command} exited with ${result.code}`);
  return result.stdout;
};

// The site's container as init left it; refused, named, when init has not run.
export const readSite = async (dir: string, run: Runner = defaultRunner): Promise<SiteContainer> => {
  const tools = join(dir, TOOLS);
  const composeFile = join(tools, 'compose.yaml');
  const envFile = join(tools, '.env');
  if (!existsSync(composeFile) || !existsSync(envFile)) throw new ContainerError(`${existsSync(composeFile) ? `${TOOLS}/.env` : `${TOOLS}/compose.yaml`} is missing: run site-content-bot init first`);
  const env = readEnv(envFile) as Record<string, string | undefined>;
  let engine = env.CONTENT_BOT_ENGINE as Engine | undefined;
  if (engine && !ENGINES.includes(engine)) throw new ContainerError(`CONTENT_BOT_ENGINE is ${JSON.stringify(engine)}; it is one of ${ENGINES.join(', ')}`);
  if (!engine) engine = (await detectEngine(execOf(run))) ?? undefined;
  if (!engine) throw new ContainerError('no container engine answers: install Docker (docker compose) or Podman (podman compose)');
  let llm: LlmName;
  try { llm = llmOf(env.CONTENT_BOT_LLM || undefined); } catch (error) { throw new ContainerError((error as Error).message); }
  return { dir, tools, composeFile, engine, container: env.CONTENT_BOT_CONTAINER || DEFAULT_CONTAINER, url: env.CONTENT_BOT_URL ?? '', llm };
};

export interface Io {
  out: (line: string) => void;
  run?: Runner;
  // Whether the person is at a terminal (the logins ask them).
  terminal?: boolean;
  sleep?: (ms: number) => Promise<void>;
  // The health wait, in ms.
  timeoutMs?: number;
  intervalMs?: number;
}

const shown = (command: string, args: string[]): string => [command, ...args].map((part) => (/^[\w./:@=+-]+$/.test(part) ? part : JSON.stringify(part))).join(' ');

const step = async (io: Io, site: SiteContainer, command: string, args: string[], { interactive = false, cwd = site.tools }: { interactive?: boolean; cwd?: string } = {}): Promise<RunResult> => {
  io.out(`$ ${shown(command, args)}`);
  return (io.run ?? defaultRunner)(command, args, { cwd, interactive });
};

// This host's own settings for the container (extra_hosts, a proxy, …), never committed: compose reads it
// only when named, as -f compose.yaml turns its own lookup off.
export const OVERRIDE_FILE = 'compose.override.yaml';

const compose = (io: Io, site: SiteContainer, args: string[], options: { interactive?: boolean } = {}): Promise<RunResult> => {
  const [command, ...rest] = composeCommand(site.engine);
  const files = ['-f', 'compose.yaml', ...(existsSync(join(site.tools, OVERRIDE_FILE)) ? ['-f', OVERRIDE_FILE] : [])];
  return step(io, site, command!, [...rest, ...files, ...args], options);
};

const must = (result: RunResult, what: string): void => {
  if (result.code !== 0) throw new ContainerError(`${what} failed (exit ${result.code})${result.stderr.trim() ? `: ${result.stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`);
};

const inspect = async (io: Io, site: SiteContainer, format: string): Promise<string> => {
  const result = await (io.run ?? defaultRunner)(runner(site.engine), ['inspect', '-f', format, site.container], { cwd: site.tools });
  return result.code === 0 ? result.stdout.trim() : '';
};

// Until the health check says healthy; unhealthy, gone or too long: false.
export const waitHealthy = async (io: Io, site: SiteContainer): Promise<boolean> => {
  const { timeoutMs = 180_000, intervalMs = 2000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = io;
  io.out(`waiting for ${site.container} to be healthy (${Math.round(timeoutMs / 1000)} s at most)…`);
  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    const health = await inspect(io, site, '{{.State.Health.Status}}');
    if (health === 'healthy') return true;
    if (health === 'unhealthy') return false;
    await sleep(intervalMs);
  }
  return false;
};

export const loginCommand = (llm: LlmName): string[] => (llm === 'codex' ? ['codex', 'login', '--device-auth'] : ['claude']);

const notLoggedIn = (checkOutput: string): boolean => /^FAIL .*(?:is not logged in|not logged in in the container)/m.test(checkOutput);

const checkIn = async (io: Io, site: SiteContainer): Promise<RunResult> => {
  const result = await step(io, site, runner(site.engine), ['exec', site.container, 'site-content-bot', 'check']);
  for (const line of `${result.stdout}`.split('\n').filter(Boolean)) io.out(`  ${line}`);
  return result;
};

const loginIn = async (io: Io, site: SiteContainer): Promise<void> => {
  const command = loginCommand(site.llm);
  if (!io.terminal) throw new ContainerError(`the ${site.llm} CLI is not logged in; at a terminal run: ${shown(runner(site.engine), ['exec', '-it', site.container, ...command])}`);
  io.out(site.llm === 'claude' ? 'The claude CLI opens: type /login, follow it, then /exit.' : 'codex prints a code and an address: open it in a browser and enter the code.');
  const result = await step(io, site, runner(site.engine), ['exec', '-it', site.container, ...command], { interactive: true });
  if (result.code !== 0) throw new ContainerError(`the ${site.llm} login ended with exit ${result.code}`);
};

// Up, healthy, checked, logged in; the address at the end. 0 when the bot can answer.
const bringUp = async (io: Io, site: SiteContainer): Promise<number> => {
  must(await compose(io, site, ['up', '-d']), 'compose up');
  if (!(await waitHealthy(io, site))) {
    io.out(`${site.container} is not healthy; its last lines:`);
    const logs = await compose(io, site, ['logs', '--tail', '50']);
    for (const line of `${logs.stdout}${logs.stderr}`.split('\n').filter(Boolean).slice(-50)) io.out(`  ${line}`);
    return 1;
  }
  let check = await checkIn(io, site);
  if (check.code !== 0 && notLoggedIn(check.stdout)) {
    try {
      await loginIn(io, site);
    } catch (error) {
      io.out(String((error as Error).message));
      return 1;
    }
    check = await checkIn(io, site);
  }
  if (check.code !== 0) {
    io.out('the check failed (above); the container is left running. `site-content-bot logs` shows more.');
    return 1;
  }
  io.out(`The bot is at ${site.url || '(CONTENT_BOT_URL is empty)'}`);
  return 0;
};

export const start = async (site: SiteContainer, io: Io): Promise<number> => bringUp(io, site);

export const stop = async (site: SiteContainer, io: Io): Promise<number> => {
  must(await compose(io, site, ['down']), 'compose down');
  io.out(`${site.container} is stopped; its volume (the clone, the copies, the logins) is kept.`);
  return 0;
};

export const logs = async (site: SiteContainer, io: Io, { follow = false }: { follow?: boolean } = {}): Promise<number> => {
  const result = await compose(io, site, ['logs', ...(follow ? ['--follow'] : []), '--tail', '200'], { interactive: true });
  return result.code;
};

export const status = async (site: SiteContainer, io: Io): Promise<number> => {
  const ps = await compose(io, site, ['ps']);
  for (const line of ps.stdout.split('\n').filter(Boolean)) io.out(`  ${line}`);
  const state = await inspect(io, site, '{{.State.Status}}');
  if (state !== 'running') {
    io.out(`${site.container} is not running${state ? ` (${state})` : ''}: site-content-bot start`);
    return 1;
  }
  return (await checkIn(io, site)).code === 0 ? 0 : 1;
};

// The image's tag in compose.yaml: --to, else this CLI's version; then pull and up.
export const update = async (site: SiteContainer, io: Io, { to, version }: { to?: string; version: string }): Promise<number> => {
  const target = (to ?? version).replace(/^v/, '');
  if (!VERSION.test(target)) throw new ContainerError(`the version is MAJOR.MINOR.PATCH, not ${JSON.stringify(to ?? version)}`);
  const text = readFileSync(site.composeFile, 'utf8');
  if (/^\s*build\s*:/m.test(text)) throw new ContainerError(`${TOOLS}/compose.yaml builds its own image (build:); remove build: and the Dockerfile, or run site-content-bot init again to write the image's compose file`);
  const match = text.match(IMAGE_LINE);
  if (!match) throw new ContainerError(`${TOOLS}/compose.yaml does not name ${IMAGE}; update its image: line yourself, or set CONTENT_BOT_IMAGE in .env`);
  if (match[2] === target) io.out(`compose.yaml already names ${IMAGE}:${target}`);
  else {
    writeFileSync(site.composeFile, text.replace(IMAGE_LINE, `$1${target}$3`));
    io.out(`compose.yaml: ${IMAGE}:${match[2]} → ${target}`);
  }
  must(await compose(io, site, ['pull']), 'compose pull');
  return bringUp(io, site);
};

export const login = async (site: SiteContainer, io: Io): Promise<number> => {
  await loginIn(io, site);
  return (await checkIn(io, site)).code === 0 ? 0 : 1;
};

