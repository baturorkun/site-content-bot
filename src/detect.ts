// What the wizard (wizard.ts) finds out by itself before it asks: the
// repository's remote and the platform behind it, the container engine on the
// machine, and the site's shape (package manager, build output, content files,
// deploy jobs, version policy, layout). Each finding is a proposal the person
// accepts or changes; nothing here writes.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { EditableEntry, PolicyName } from './config.js';
import type { PlatformName } from './platform.js';

export type Exec = (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<string>;

// Runs a command and gives its stdout; rejects when it fails or is missing.
export const defaultExec: Exec = (command, args, { cwd, env } = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { cwd, env: env ? { ...process.env, ...env } : process.env, encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => {
    if (error) return reject(new Error(String(stderr || error.message).trim().split('\n')[0] || error.message));
    resolve(String(stdout));
  });
});

export interface Remote { url: string; host: string; project: string }

// A git remote as the bot needs it: its https form (git fetches with the token
// over HTTP) and its project path. git@host:owner/repo.git, ssh://git@host/owner/repo,
// https://host/owner/repo.git all give https://host/owner/repo.git and owner/repo.
export const parseRemote = (remote: string): Remote | null => {
  const text = remote.trim();
  if (!text) return null;
  let host = '';
  let path = '';
  const scp = text.match(/^(?:[\w.-]+@)?([\w.-]+):(?![\d/])([^\s]+)$/);
  if (scp) {
    [, host, path] = scp as unknown as [string, string, string];
  } else {
    try {
      const url = new URL(text);
      if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) return null;
      host = url.hostname;
      path = url.pathname;
    } catch { return null; }
  }
  const project = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (!host || !project || !project.includes('/')) return null;
  return { url: `https://${host}/${project}.git`, host, project };
};

export const detectRemote = async (dir: string, exec: Exec = defaultExec): Promise<Remote | null> => {
  try { return parseRemote(await exec('git', ['remote', 'get-url', 'origin'], { cwd: dir })); } catch { return null; }
};

export type Engine = 'docker' | 'podman' | 'podman-compose';
export const ENGINES: Engine[] = ['docker', 'podman', 'podman-compose'];

// The compose command of an engine: what start (RQ-0004) runs.
export const composeCommand = (engine: Engine): string[] => (engine === 'podman-compose' ? ['podman-compose'] : [engine, 'compose']);

// The first container engine whose compose answers: docker, podman, podman-compose; null with none.
export const detectEngine = async (exec: Exec = defaultExec): Promise<Engine | null> => {
  for (const engine of ENGINES) {
    try {
      const [command, ...args] = composeCommand(engine);
      await exec(command!, [...args, 'version']);
      return engine;
    } catch { /* the next one */ }
  }
  return null;
};

export type PackageManager = 'pnpm' | 'yarn' | 'npm';

export const packageManager = (dir: string): PackageManager => {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
};

export const readPackage = (dir: string): Record<string, any> | null => {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { return null; }
};

const installCommand = (pm: PackageManager): string => ({
  pnpm: 'pnpm --dir "$CLONE" install --frozen-lockfile --prefer-offline >/dev/null',
  yarn: 'yarn --cwd "$CLONE" install --frozen-lockfile >/dev/null',
  npm: 'npm --prefix "$CLONE" ci >/dev/null',
}[pm]);

const runScript = (pm: PackageManager, script: string): string => (pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`);

// The build: an install in the clone, node_modules linked, the build script.
export const buildCommand = (dir: string): string | undefined => {
  const pkg = readPackage(dir);
  if (!pkg) return undefined;
  const pm = packageManager(dir);
  const steps = [installCommand(pm), 'ln -s "$CLONE/node_modules" node_modules'];
  if (pkg.scripts?.build) steps.push(`${runScript(pm, 'build')} >/dev/null`);
  return steps.join(' && ');
};

// The checks: an install and the test script, else true (to be replaced).
export const checksCommand = (dir: string): string => {
  const pkg = readPackage(dir);
  if (!pkg) return 'true';
  const pm = packageManager(dir);
  const install = { pnpm: 'pnpm install --frozen-lockfile --prefer-offline >/dev/null', yarn: 'yarn install --frozen-lockfile >/dev/null', npm: 'npm ci >/dev/null' }[pm];
  return pkg.scripts?.test ? `${install} && ${runScript(pm, 'test')}` : 'true';
};

const OUTPUTS = ['dist', 'build', 'out', 'public', 'release/site', '_site'];

const gitignored = (dir: string): string[] => {
  try { return readFileSync(join(dir, '.gitignore'), 'utf8').split('\n').map((line) => line.trim().replace(/^\//, '').replace(/\/$/, '')).filter(Boolean); } catch { return []; }
};

// The directory the build leaves: the first candidate .gitignore names (a
// build output is ignored), else the first that exists, but never public/
// unless it is ignored (on Vite and the like it is the build's input), else dist.
export const buildOutput = (dir: string): string => {
  const ignored = gitignored(dir);
  const exists = (candidate: string) => existsSync(join(dir, candidate)) && statSync(join(dir, candidate)).isDirectory();
  return OUTPUTS.find((candidate) => ignored.includes(candidate)) ?? OUTPUTS.find((candidate) => candidate !== 'public' && exists(candidate)) ?? 'dist';
};

// The files under a directory, relative, without node_modules and .git, to a depth.
const walk = (root: string, depth = 6): string[] => {
  const found: string[] = [];
  const visit = (rel: string, left: number) => {
    let names: string[] = [];
    try { names = readdirSync(join(root, rel)); } catch { return; }
    for (const name of names) {
      if (name === 'node_modules' || name === '.git') continue;
      const path = rel ? `${rel}/${name}` : name;
      let isDir = false;
      try { isDir = statSync(join(root, path)).isDirectory(); } catch { continue; }
      if (isDir) { if (left > 0) visit(path, left - 1); } else found.push(path);
    }
  };
  visit('', depth);
  return found;
};

export const GENERIC_RULE = 'the text inside string literals; never keys, imports, paths or the structure of the file';

// The content files a site usually keeps its texts in, as editable entries.
export const contentFiles = (dir: string): EditableEntry[] => {
  const entries: EditableEntry[] = [];
  const isDir = (path: string) => existsSync(join(dir, path)) && statSync(join(dir, path)).isDirectory();
  if (isDir('src/content')) {
    for (const name of readdirSync(join(dir, 'src/content')).filter((file) => /\.(ts|js|mjs|json)$/.test(file)).sort()) entries.push({ path: `src/content/${name}`, kind: 'text', rule: GENERIC_RULE });
  }
  for (const folder of ['src/i18n', 'src/locales', 'locales']) if (isDir(folder)) entries.push({ glob: `${folder}/**`, kind: 'text', rule: GENERIC_RULE });
  if (isDir('content')) entries.push({ glob: 'content/**/*.json', kind: 'text', rule: GENERIC_RULE }, { glob: 'content/**/*.md', kind: 'text', rule: GENERIC_RULE });
  if (isDir('public') && walk(join(dir, 'public')).some((file) => file.endsWith('.svg'))) entries.push({ glob: 'public/**/*.svg', kind: 'svg-text' });
  return entries;
};

export interface DeployJobs { test?: string; production?: string; found: string[] }

// The deploy jobs of the pipeline file: .gitlab-ci.yml top-level keys, or the
// jobs of .github/workflows/*.yml (their keys and name: values), that contain
// "deploy". The one that also says release, prod or tag is production.
export const deployJobs = (dir: string): DeployJobs => {
  const found: string[] = [];
  const gitlab = join(dir, '.gitlab-ci.yml');
  if (existsSync(gitlab)) {
    for (const match of readFileSync(gitlab, 'utf8').matchAll(/^([\w.-]+):\s*$/gm)) if (/deploy/i.test(match[1]!)) found.push(match[1]!);
  }
  const workflows = join(dir, '.github/workflows');
  if (existsSync(workflows)) {
    for (const file of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name)).sort()) {
      const text = readFileSync(join(workflows, file), 'utf8');
      const jobs = text.split(/^jobs:\s*$/m)[1];
      if (!jobs) continue;
      for (const match of jobs.matchAll(/^ {2}([\w.-]+):\s*$/gm)) {
        const key = match[1]!;
        const body = jobs.slice(match.index! + match[0].length).split(/^ {2}[\w.-]+:\s*$/m)[0] ?? '';
        const name = body.match(/^ {4}name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
        if (/deploy/i.test(name ?? '')) found.push(name!);
        else if (/deploy/i.test(key)) found.push(key);
      }
    }
  }
  const unique = [...new Set(found)];
  const production = unique.find((job) => /release|prod|tag/i.test(job));
  const test = unique.find((job) => job !== production) ?? production;
  return { ...(test ? { test } : {}), ...(production ? { production } : test ? { production: test } : {}), found: unique };
};

export const versionPolicyFor = (dir: string): PolicyName => (existsSync(join(dir, 'requirements')) ? 'aifactory' : 'patch');

const LAYOUT_DIRS = ['src', 'public', 'app', 'pages', 'components', 'styles'];

export const layoutOf = (dir: string): string | undefined => {
  const present = LAYOUT_DIRS.filter((name) => existsSync(join(dir, name)) && statSync(join(dir, name)).isDirectory());
  return present.length ? `layout, code and styles: ${present.map((name) => `${name}/`).join(', ')}` : undefined;
};

export const proposedBotUrl = (): string => `http://${hostname()}:8290`;

// Which platform a host is, without a token: by its name (github.com,
// github.*; gitlab.com, gitlab.*), else by asking the server: GitHub
// Enterprise answers GET /api/v3/meta with its installed_version, GitLab's
// API answers GET /api/v4/version (401 without a token) with an X-Gitlab-Meta
// header or a "401 Unauthorized" message. Unknown: null, and the wizard asks
// without a proposal it cannot stand behind.
export const probePlatform = async (host: string, fetchImpl: typeof fetch = fetch): Promise<{ platform: PlatformName | null; from: string }> => {
  const name = host.toLowerCase();
  if (name === 'github.com' || name.startsWith('github.')) return { platform: 'github', from: `the remote's host ${host}` };
  if (name === 'gitlab.com' || name.startsWith('gitlab.')) return { platform: 'gitlab', from: `the remote's host ${host}` };
  const get = async (path: string): Promise<Response | null> => {
    try { return await fetchImpl(`https://${host}${path}`, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } }); } catch { return null; }
  };
  const meta = await get('/api/v3/meta');
  if (meta?.ok) {
    const body: any = await meta.json().catch(() => ({}));
    if (body && ('installed_version' in body || 'verifiable_password_authentication' in body)) return { platform: 'github', from: `${host} answers as GitHub Enterprise` };
  }
  const version = await get('/api/v4/version');
  if (version && (version.headers?.get?.('x-gitlab-meta') || [200, 401].includes(version.status))) {
    const body: any = await version.json().catch(() => ({}));
    if (version.headers?.get?.('x-gitlab-meta') || body?.version || /401 Unauthorized/.test(String(body?.message ?? ''))) return { platform: 'gitlab', from: `${host} answers as GitLab` };
  }
  return { platform: null, from: `${host} did not say whether it is GitLab or GitHub` };
};

export interface Findings {
  remote: Remote | null;
  // null: the host did not tell; the wizard asks without a proposal.
  platform: PlatformName | null;
  platformFrom: string;
  platformUrl: string;
  engine: Engine | null;
  brandName: string;
  build: { command?: string; output: string };
  editable: EditableEntry[];
  checks: string;
  deploy: DeployJobs;
  version: PolicyName;
  layout?: string;
  homepage?: string;
  botUrl: string;
}

// Everything the wizard proposes before it asks.
export const detect = async (dir: string, exec: Exec = defaultExec, fetchImpl: typeof fetch = fetch): Promise<Findings> => {
  const remote = await detectRemote(dir, exec);
  const { platform, from: platformFrom } = remote ? await probePlatform(remote.host, fetchImpl) : { platform: null, from: 'no git remote' };
  const pkg = readPackage(dir);
  const homepage = typeof pkg?.homepage === 'string' && /^https?:\/\//.test(pkg.homepage) ? pkg.homepage : undefined;
  const name = typeof pkg?.name === 'string' && pkg.name ? pkg.name.replace(/^@[^/]+\//, '') : remote?.project.split('/').pop() ?? '';
  return {
    remote,
    platform,
    platformFrom,
    platformUrl: remote && !(platform === 'github' && remote.host === 'github.com') ? `https://${remote.host}` : '',
    engine: await detectEngine(exec),
    brandName: name,
    build: { command: buildCommand(dir), output: buildOutput(dir) },
    editable: contentFiles(dir),
    checks: checksCommand(dir),
    deploy: deployJobs(dir),
    version: versionPolicyFor(dir),
    layout: layoutOf(dir),
    homepage,
    botUrl: proposedBotUrl(),
  };
};
