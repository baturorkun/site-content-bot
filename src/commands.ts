// site-content-bot's commands: serve (the bot), check (is everything in place), init (what
// a site needs to run it). Settings come from the environment (README.md), the
// site's description from content-bot.config.mjs at the root of its repository.
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GitLabAuth } from './auth.js';
import { ContentBot } from './bot.js';
import { askClaude } from './claude.js';
import { CONFIG_FILE, loadConfig, type Config } from './config.js';
import { Editable } from './edits.js';
import { createRelease, deployState, lastGreenMain, latestRelease, projectReachable } from './gitlab.js';
import { Repo } from './repo.js';
import { createApp } from './server.js';
import { Site } from './site.js';
import { versionPolicy } from './version.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', 'assets');

const HELP = `Usage: site-content-bot <command> [options]

Commands:
  serve [--config <file>]   start the bot (settings from the environment,
                            the site's description from ${CONFIG_FILE}
                            at the root of the cloned repository)
  check [--config <file>]   report whether everything is in place, exit 1 if not
  init [--dir <path>]       write what a site needs: ${CONFIG_FILE},
                            tools/content-bot/{Dockerfile,compose.yaml,.env.example}

Options:
  -h, --help     show this help
  -v, --version  print the version`;

const version = (): string => (JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { version: string }).version;

// The variables, as the README lists them. Removed ones name the config field that took over.
const REQUIRED = ['CONTENT_BOT_REPO_URL', 'CONTENT_BOT_GITLAB_TOKEN', 'GITLAB_URL', 'CONTENT_BOT_URL', 'CONTENT_BOT_OAUTH_ID', 'CONTENT_BOT_OAUTH_SECRET', 'CONTENT_BOT_GITLAB_PROJECT'];
const REMOVED: Record<string, string> = {
  CONTENT_BOT_TEST_URL: 'urls.test',
  CONTENT_BOT_PROD_URL: 'urls.production',
  CONTENT_BOT_BUILD: 'build.command',
  CONTENT_BOT_CHECKS: 'checks',
};

class Usage extends Error {}

const removedVariables = (env: NodeJS.ProcessEnv): string[] => Object.keys(REMOVED).filter((name) => env[name] !== undefined && env[name] !== '');

const settings = (env: NodeJS.ProcessEnv) => ({
  repoUrl: env.CONTENT_BOT_REPO_URL ?? '',
  token: env.CONTENT_BOT_GITLAB_TOKEN ?? '',
  gitlabUrl: env.GITLAB_URL ?? '',
  botUrl: env.CONTENT_BOT_URL ?? '',
  oauthId: env.CONTENT_BOT_OAUTH_ID ?? '',
  oauthSecret: env.CONTENT_BOT_OAUTH_SECRET ?? '',
  project: env.CONTENT_BOT_GITLAB_PROJECT ?? '',
  minAccess: Number(env.CONTENT_BOT_MIN_ACCESS || 30),
  model: env.CONTENT_BOT_MODEL || 'claude-opus-5-5',
  siteDir: env.CONTENT_BOT_SITE_DIR || '/data/site',
  repoDir: env.CONTENT_BOT_REPO_DIR || '/data/repo',
  port: Number(env.CONTENT_BOT_PORT || 8290),
  claude: env.CLAUDE_EXECUTABLE || 'claude',
});

// git's GIT_ASKPASS: the token from the environment, never in the remote URL.
// The script is copied where it can be executable, whatever the package's mode.
const askpass = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'content-bot-askpass-'));
  const file = join(dir, 'askpass.sh');
  copyFileSync(join(ASSETS, 'askpass.sh'), file);
  chmodSync(file, 0o700);
  return file;
};

const makeRepo = (env: NodeJS.ProcessEnv): Repo => {
  const s = settings(env);
  return new Repo({ dir: s.repoDir, url: s.repoUrl, env: s.token ? { GIT_ASKPASS: askpass(), CONTENT_BOT_GITLAB_TOKEN: s.token } : {} });
};

// The config: --config, else the file at the clone's root.
const configOf = async (repo: Repo, configPath: string | undefined): Promise<Config> => loadConfig(configPath ?? join(repo.dir, CONFIG_FILE));

const refuse = (message: string): never => {
  throw new Usage(message);
};

export const serve = async (env: NodeJS.ProcessEnv, { configPath }: { configPath?: string } = {}): Promise<void> => {
  const removed = removedVariables(env);
  if (removed.length) refuse(`${removed.map((name) => `${name} has moved to ${CONFIG_FILE} (${REMOVED[name]})`).join('; ')}; unset ${removed.length === 1 ? 'it' : 'them'}.`);
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) refuse(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} empty (see README.md).`);
  const s = settings(env);
  const repo = makeRepo(env);
  await repo.sync();
  const config = await configOf(repo, configPath);
  const gitlab = { url: s.gitlabUrl, project: s.project, token: s.token };
  const deploy = (sha: string) => deployState({ ...gitlab, sha });
  const site = new Site({ repo, root: s.siteDir, build: config.build, exclude: config.exclude, latestRelease: () => latestRelease(gitlab) });
  const bot = new ContentBot({
    repo,
    site,
    config,
    deploy,
    releases: {
      candidate: () => lastGreenMain(gitlab),
      create: (release) => createRelease({ ...gitlab, ...release }),
      state: (tag) => deployState({ ...gitlab, ref: tag, job: 'deploy_release' }),
    },
    ask: (prompt, schema, dirs) => askClaude({ executable: s.claude, model: s.model, prompt, schema, dirs }),
  });
  const auth = new GitLabAuth({
    url: s.gitlabUrl,
    clientId: s.oauthId,
    secret: s.oauthSecret,
    redirectUri: `${s.botUrl.replace(/\/$/, '')}/auth/callback`,
    project: s.project,
    token: s.token,
    minAccess: s.minAccess,
  });
  const login = { host: new URL(s.gitlabUrl).host, project: s.project, minAccess: s.minAccess };
  createApp({ auth, bot, deploy, config, login, llm: { provider: 'claude-cli (subscription)', model: s.model } })
    .listen(s.port, () => console.log(`${config.brand.title}: listening on :${s.port}, model ${s.model}, GitLab login for ${s.project} (access level ${s.minAccess}+), ${config.brand.name}`));
};

const lsRemote = (repo: Repo): Promise<void> => new Promise((resolvePromise, reject) => {
  execFile('git', ['ls-remote', '--heads', repo.url, repo.branch], { env: repo.env, timeout: 60_000, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) return reject(new Error(String(stderr || error.message).trim().split('\n')[0]));
    if (!String(stdout).trim()) return reject(new Error(`no branch ${repo.branch} there`));
    resolvePromise();
  });
});

// One line per item; the result says whether every item passed.
export const check = async (env: NodeJS.ProcessEnv, { configPath, out = console.log }: { configPath?: string; out?: (line: string) => void } = {}): Promise<boolean> => {
  let ok = true;
  const report = (passed: boolean, what: string, detail = '') => {
    ok &&= passed;
    out(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
  };
  const tryIt = async <T>(what: string, run: () => Promise<T>, said: (value: T) => string = () => ''): Promise<T | undefined> => {
    try {
      const value = await run();
      report(true, what, said(value));
      return value;
    } catch (error) {
      report(false, what, String(error?.message ?? error).split('\n')[0]);
      return undefined;
    }
  };

  for (const name of REQUIRED) report(Boolean(env[name]), `${name} is set`);
  for (const name of removedVariables(env)) report(false, `${name} is not set`, `it has moved to ${CONFIG_FILE} (${REMOVED[name]})`);
  const s = settings(env);
  const repo = makeRepo(env);
  if (s.repoUrl) await tryIt(`the repository ${s.repoUrl} answers the token`, () => lsRemote(repo));
  const configFile = configPath ?? join(repo.dir, CONFIG_FILE);
  const config = await tryIt(`${configFile} loads`, () => loadConfig(configFile), (loaded) => {
    const editable = new Editable(loaded.editable);
    return `${loaded.brand.name}; ${editable.summary()}; version: ${versionPolicy(loaded.version).label}`;
  });
  void config;
  if (s.gitlabUrl && s.project && s.token) await tryIt(`GitLab's API answers for ${s.project}`, () => projectReachable({ url: s.gitlabUrl, project: s.project, token: s.token }), (path) => path);
  await tryIt(`${s.claude} answers (logged in)`, () => askClaude({
    executable: s.claude,
    model: s.model,
    prompt: 'Answer with the JSON asked for: ok true.',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
    timeoutMs: 120_000,
  }), () => `model ${s.model}`);
  return ok;
};

// What a site needs to run the bot, written once; an existing file is kept.
export const init = (dir: string, { out = console.log }: { out?: (line: string) => void } = {}): { written: string[]; kept: string[] } => {
  const files: [string, string, (text: string) => string][] = [
    [CONFIG_FILE, 'content-bot.config.mjs', (text) => text],
    ['tools/content-bot/Dockerfile', 'Dockerfile', (text) => text.replace('{{version}}', version())],
    ['tools/content-bot/compose.yaml', 'compose.yaml', (text) => text],
    ['tools/content-bot/.env.example', 'env.example', (text) => text],
  ];
  const written: string[] = [];
  const kept: string[] = [];
  for (const [target, source, fill] of files) {
    const path = join(dir, target);
    if (existsSync(path)) {
      kept.push(target);
      out(`kept     ${target}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, fill(readFileSync(join(ASSETS, 'init', source), 'utf8')));
    written.push(target);
    out(`written  ${target}`);
  }
  return { written, kept };
};

export const main = async (argv: string[]): Promise<number> => {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        config: { type: 'string' },
        dir: { type: 'string' },
      },
    });
  } catch (error) {
    console.error((error as Error).message);
    console.error(HELP);
    return 2;
  }
  const [command] = parsed.positionals;
  const configPath = parsed.values.config === undefined ? undefined : resolve(String(parsed.values.config));
  if (parsed.values.help) { console.log(HELP); return 0; }
  if (parsed.values.version) { console.log(version()); return 0; }
  try {
    switch (command) {
      case 'serve':
        await serve(process.env, { configPath });
        return -1;
      case 'check':
        return (await check(process.env, { configPath })) ? 0 : 1;
      case 'init':
        init(resolve(parsed.values.dir === undefined ? '.' : String(parsed.values.dir)));
        return 0;
      case undefined:
        console.error(HELP);
        return 2;
      default:
        console.error(`unknown command: ${command}`);
        console.error(HELP);
        return 2;
    }
  } catch (error) {
    console.error(`site-content-bot: ${String(error?.message ?? error)}`);
    return error instanceof Usage ? 2 : 1;
  }
};

