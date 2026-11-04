// init as a wizard (RQ-0003): what detect.ts found is proposed, the rest is
// asked, the token is verified on the platform, and everything the bot needs
// is written: content-bot.config.mjs and tools/content-bot/{Dockerfile,
// compose.yaml} to commit, tools/content-bot/.env never. The questions run on
// an Ask the command gives as readline and a test gives as scripted answers.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_FILE, DEFAULT_DEPLOY, loadConfig, validateConfig, type Config, type EditableEntry } from './config.js';
import { apiBase } from './github.js';
import { composeCommand, defaultExec, detect, GENERIC_RULE, type Engine, type Exec, type Findings } from './detect.js';
import { LLM_NAMES, LLMS, type LlmName } from './llm.js';
import { createPlatform, PLATFORM_NAMES, type Platform, type PlatformName } from './platform.js';

export interface Ask {
  // The answer, or the proposal when the person presses Enter.
  question(prompt: string, proposal?: string): Promise<string>;
  // A secret: not echoed.
  secret(prompt: string): Promise<string>;
  note(text: string): void;
}

// The settings the wizard writes to .env, by their flag names.
export const FLAGS = ['repo-url', 'platform', 'platform-url', 'project', 'engine', 'url', 'port', 'oauth-id', 'oauth-secret', 'token', 'min-access', 'llm', 'model', 'test-url', 'production-url'] as const;
export type Flag = (typeof FLAGS)[number];

export interface Settings {
  CONTENT_BOT_REPO_URL: string;
  CONTENT_BOT_PLATFORM: string;
  CONTENT_BOT_PLATFORM_URL: string;
  CONTENT_BOT_PROJECT: string;
  CONTENT_BOT_TOKEN: string;
  CONTENT_BOT_URL: string;
  CONTENT_BOT_OAUTH_ID: string;
  CONTENT_BOT_OAUTH_SECRET: string;
  CONTENT_BOT_ENGINE: string;
  CONTENT_BOT_MIN_ACCESS: string;
  CONTENT_BOT_LLM: string;
  CONTENT_BOT_MODEL: string;
  // The host port the compose file publishes; inside the container the bot listens on 8290.
  CONTENT_BOT_HOST_PORT: string;
}

export class WizardError extends Error {}

const ENV_FILE = 'tools/content-bot/.env';
const OPTIONAL: Partial<Record<keyof Settings, string>> = { CONTENT_BOT_MIN_ACCESS: '30', CONTENT_BOT_HOST_PORT: '8290', CONTENT_BOT_PLATFORM_URL: '', CONTENT_BOT_PLATFORM: '', CONTENT_BOT_ENGINE: '' };

// KEY=VALUE lines of a .env (quotes around the value dropped, comments skipped).
export const readEnv = (file: string): Partial<Settings> => {
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, '$2');
  }
  return values as Partial<Settings>;
};

const quote = (value: string): string => (/[\s#"'$\\]/.test(value) ? JSON.stringify(value) : value);

// The .env, every setting with a line, the optional ones as comments at their
// default; mode 0600: it holds the secrets.
export const writeEnv = (file: string, settings: Settings): void => {
  // The model's default is the chosen CLI's (llm.ts).
  const defaults: Partial<Record<keyof Settings, string>> = { ...OPTIONAL, CONTENT_BOT_MODEL: LLMS[(settings.CONTENT_BOT_LLM || 'claude') as LlmName]?.defaultModel ?? '' };
  const line = (key: keyof Settings, comment: string) => {
    const value = settings[key] ?? '';
    const optional = key in defaults;
    const atDefault = optional && value === defaults[key];
    return `# ${comment}\n${atDefault ? '#' : ''}${key}=${quote(atDefault ? (defaults[key] || '') : value)}`;
  };
  const text = [
    '# site-content-bot settings, written by `site-content-bot init`: where the bot runs and its',
    '# secrets. Never committed (.gitignore). What the site is: content-bot.config.mjs.',
    '',
    line('CONTENT_BOT_REPO_URL', 'The repository over HTTP.'),
    line('CONTENT_BOT_PLATFORM', 'gitlab or github; empty: from the repository host.'),
    line('CONTENT_BOT_PLATFORM_URL', 'The platform: the GitLab instance; GitHub Enterprise; empty for github.com.'),
    line('CONTENT_BOT_PROJECT', 'The project: group/site on GitLab, owner/repo on GitHub.'),
    line('CONTENT_BOT_TOKEN', 'The token the bot pushes and releases with.'),
    line('CONTENT_BOT_URL', 'The bot as the browser reaches it; the login comes back to <it>/auth/callback.'),
    line('CONTENT_BOT_OAUTH_ID', 'The OAuth application.'),
    line('CONTENT_BOT_OAUTH_SECRET', 'Its secret.'),
    line('CONTENT_BOT_ENGINE', 'The container engine start uses: docker, podman or podman-compose.'),
    line('CONTENT_BOT_MIN_ACCESS', 'The access a person needs: 30 = Developer on GitLab, write on GitHub.'),
    line('CONTENT_BOT_LLM', 'The language model CLI that answers: claude or codex.'),
    line('CONTENT_BOT_MODEL', "That CLI's model; empty: its default (claude-opus-5-5 for claude, codex's own for codex)."),
    line('CONTENT_BOT_HOST_PORT', 'The host port the compose file publishes (the bot listens on 8290 inside).'),
    '',
  ].join('\n');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
};

// The config as a module: every field, no comments (the example in the README
// has them). A version function cannot be written back; it is kept by name.
export const configSource = (config: Config): string => {
  const plain = { ...config, version: typeof config.version === 'function' ? 'aifactory' : config.version };
  return `// content-bot.config.mjs: how this site describes itself to site-content-bot (written by\n// \`site-content-bot init\`; the fields are explained in the package's README). Read once, when the\n// bot starts: a change here takes effect on its restart.\nexport default ${JSON.stringify(plain, null, 2).replace(/"([a-zA-Z_]\w*)":/g, '$1:')};\n`;
};

// tools/content-bot/.env in .gitignore.
export const ignoreEnv = (dir: string): boolean => {
  const file = join(dir, '.gitignore');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  if (lines.some((line) => ['tools/content-bot/.env', '/tools/content-bot/.env', '.env', '**/.env', '*.env'].includes(line.trim()))) return false;
  const text = lines.join('\n');
  writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# site-content-bot: the bot's settings and secrets stay on the host\n${ENV_FILE}\n`);
  return true;
};

// "path:kind, glob:kind" <-> entries, for the one-line question.
export const editableToLine = (entries: EditableEntry[]): string => entries.map((entry) => `${entry.path ?? entry.glob}:${entry.kind}`).join(', ');
export const editableFromLine = (line: string, rules: EditableEntry[] = []): EditableEntry[] => line.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
  const at = item.lastIndexOf(':');
  const target = at === -1 ? item : item.slice(0, at);
  const kind = at === -1 ? (target.endsWith('.svg') ? 'svg-text' : 'text') : item.slice(at + 1).trim();
  if (kind !== 'text' && kind !== 'svg-text') throw new WizardError(`${item}: the kind is text or svg-text`);
  const isGlob = /[*?]/.test(target);
  const known = rules.find((entry) => (entry.path ?? entry.glob) === target);
  return { ...(isGlob ? { glob: target } : { path: target }), kind, ...(kind === 'text' ? { rule: known?.rule ?? GENERIC_RULE } : {}) } as EditableEntry;
});

export interface VerifyInput { platformName: PlatformName; platform: Platform; url: string; project: string; token: string; repoUrl: string; fetchImpl?: typeof fetch; exec?: Exec; askpass?: string }

// The token, checked on the platform before it is written: the project answers
// it, it may push (GitLab: the scopes of the token; GitHub: permissions.push),
// and git reaches the repository with it.
export const verifyToken = async ({ platformName, platform, url, project, token, repoUrl, fetchImpl = fetch, exec = defaultExec, askpass }: VerifyInput): Promise<string[]> => {
  const said: string[] = [];
  let reachable: string;
  try {
    reachable = await platform.projectReachable();
  } catch (error) {
    const message = String(error?.message ?? error);
    // fetch's own words say nothing of where: name the address.
    throw new Error(/^fetch failed|ENOTFOUND|ECONNREFUSED|timed? ?out/i.test(message) ? `${url} did not answer (${message.split('\n')[0]})` : message);
  }
  said.push(`the project answers: ${reachable}`);
  if (platformName === 'gitlab') {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/api/v4/personal_access_tokens/self`, { headers: { 'PRIVATE-TOKEN': token } });
    if (response.ok) {
      const body: any = await response.json();
      const scopes: string[] = body.scopes ?? [];
      const missing = ['api', 'write_repository'].filter((scope) => !scopes.includes(scope));
      if (missing.length) throw new Error(`the token lacks the scope${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (it has ${scopes.join(', ') || 'none'})`);
      said.push(`scopes ${scopes.join(', ')}`);
    } else if (response.status === 404) {
      said.push('the scopes could not be read (no /personal_access_tokens/self on this GitLab)');
    } else throw new Error(`GitLab answered ${response.status} for the token itself`);
  } else {
    const response = await fetchImpl(`${apiBase(url)}/repos/${project}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'site-content-bot' } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for the repository`);
    const body: any = await response.json();
    if (!body.permissions?.push) throw new Error(`the token cannot push to ${project} (permissions: ${Object.entries(body.permissions ?? {}).filter(([, on]) => on).map(([name]) => name).join(', ') || 'none'})`);
    said.push('the token can push');
  }
  const env: NodeJS.ProcessEnv = askpass ? { GIT_ASKPASS: askpass, CONTENT_BOT_TOKEN: token, CONTENT_BOT_GIT_USER: platformName === 'github' ? 'x-access-token' : 'oauth2', GIT_TERMINAL_PROMPT: '0' } : { GIT_TERMINAL_PROMPT: '0' };
  const heads = await exec('git', ['ls-remote', '--heads', repoUrl, 'main'], { env });
  if (!heads.trim()) throw new Error(`git reaches ${repoUrl} but finds no main branch`);
  said.push('git reaches the repository');
  return said;
};

export interface WizardOptions {
  dir: string;
  ask: Ask;
  yes?: boolean;
  given?: Partial<Record<Flag, string>>;
  env?: NodeJS.ProcessEnv;
  exec?: Exec;
  fetchImpl?: typeof fetch;
  // This package's version, for the Dockerfile.
  version: string;
  // The init templates (assets/init).
  templates: string;
  askpass?: string;
  verify?: typeof verifyToken;
  findings?: Findings;
}

export interface WizardResult { written: string[]; kept: string[]; settings: Settings; config: Config; engine: Engine | null; warnings: string[] }

const accessName = (platform: PlatformName, level: string): string => ({ gitlab: { 30: 'Developer', 40: 'Maintainer', 50: 'Owner' }, github: { 30: 'write', 40: 'maintain', 50: 'admin' } }[platform] as Record<string, string>)[level] ?? `level ${level}`;

export const runWizard = async (options: WizardOptions): Promise<WizardResult> => {
  const { dir, ask, yes = false, given = {}, env = {}, exec = defaultExec, fetchImpl = fetch, templates, version, askpass, verify = verifyToken } = options;
  const warnings: string[] = [];
  const found = options.findings ?? await detect(dir, exec, fetchImpl);
  const envFile = join(dir, ENV_FILE);
  const current = readEnv(envFile);
  const configFile = join(dir, CONFIG_FILE);
  let existing: Config | undefined;
  if (existsSync(configFile)) {
    try { existing = await loadConfig(configFile); } catch (error) { warnings.push(`the existing ${CONFIG_FILE} did not load (${String(error?.message ?? error).split('\n')[0]}); starting from what the repository shows`); }
  }

  // One value: the flag, else (with --yes) the proposal, else the person.
  const value = async (flag: Flag, prompt: string, proposal: string | undefined, { secret = false, required = true }: { secret?: boolean; required?: boolean } = {}): Promise<string> => {
    if (given[flag] !== undefined) return given[flag]!;
    if (yes) {
      if (proposal) return proposal;
      if (required) throw new WizardError(`--yes needs --${flag} (or the environment) for ${prompt}`);
      return '';
    }
    const answer = secret ? await ask.secret(`${prompt}${proposal ? ' [kept]' : ''}: `) || (proposal ?? '') : await ask.question(`${prompt}${proposal ? ` [${proposal}]` : ''}: `, proposal);
    if (!answer && required) {
      ask.note('A value is needed here.');
      return value(flag, prompt, proposal, { secret, required });
    }
    return answer;
  };
  // A config question: no flag; with --yes the proposal.
  const field = async (prompt: string, proposal: string | undefined, { required = true } = {}): Promise<string> => {
    if (yes) {
      if (proposal || !required) return proposal ?? '';
      throw new WizardError(`--yes needs a proposal for ${prompt}, and the repository gives none; run init without --yes once`);
    }
    const answer = await ask.question(`${prompt}${proposal ? ` [${proposal}]` : ''}: `, proposal);
    if (!answer && required) {
      ask.note('A value is needed here.');
      return field(prompt, proposal, { required });
    }
    return answer;
  };

  // 1-2. The repository and the platform.
  ask.note(`site-content-bot init in ${dir}${found.remote ? ` (remote ${found.remote.url})` : ' (no git remote found)'}`);
  if (found.platform) ask.note(`The platform: ${found.platform === 'github' ? 'GitHub' : 'GitLab'}, from ${found.platformFrom}.`);
  else ask.note(`The platform: ${found.platformFrom}; say which.`);
  const platformIn = (await value('platform', 'The platform (gitlab, github)', current.CONTENT_BOT_PLATFORM || found.platform || undefined)).toLowerCase();
  if (!PLATFORM_NAMES.includes(platformIn as PlatformName)) throw new WizardError(`the platform is gitlab or github, not ${JSON.stringify(platformIn)}`);
  const platform = platformIn as PlatformName;
  const repoUrl = await value('repo-url', 'The repository over HTTP', current.CONTENT_BOT_REPO_URL || found.remote?.url);
  const project = await value('project', platform === 'gitlab' ? 'The project (group/site)' : 'The repository (owner/repo)', current.CONTENT_BOT_PROJECT || found.remote?.project);
  // The address: the remote's host (gitlab.com, a company's own GitLab, a
  // GitHub Enterprise); github.com needs none.
  const platformUrl = await value('platform-url', platform === 'gitlab' ? 'The GitLab address (https://gitlab.com or your own)' : 'GitHub (empty for github.com; the Enterprise address otherwise)', current.CONTENT_BOT_PLATFORM_URL || found.platformUrl || (platform === 'gitlab' ? 'https://gitlab.com' : undefined), { required: platform === 'gitlab' });

  // 3. The engine.
  const engineIn = await value('engine', 'The container engine (docker, podman, podman-compose)', current.CONTENT_BOT_ENGINE || found.engine || undefined, { required: false });
  const engine = (engineIn || null) as Engine | null;
  if (!engine) warnings.push('no container engine answers: install Docker (docker compose) or Podman (podman compose) before starting the bot');
  else if (!['docker', 'podman', 'podman-compose'].includes(engine)) throw new WizardError(`the engine is docker, podman or podman-compose, not ${JSON.stringify(engine)}`);

  // 4. The site.
  ask.note(`\nThe site (${CONFIG_FILE}):`);
  const brandName = await field('The site, as the page names it', existing?.brand.name || found.brandName || undefined);
  const buildCommand = await field('The build command (run in a copy of main, CLONE set to the clone)', existing?.build.command ?? found.build.command);
  const buildOutput = await field('The directory the build leaves', existing?.build.output ?? found.build.output);
  const describe = await field('What is in it, for the model (optional)', existing?.build.describe, { required: false });
  const proposedEditable = existing?.editable.length ? existing.editable : found.editable;
  const editableLine = await field('The editable files, path:kind or glob:kind, comma-separated (kind text or svg-text)', editableToLine(proposedEditable) || undefined);
  const editable = editableFromLine(editableLine, proposedEditable);
  const checks = await field('The checks before a push (run in the clone)', existing?.checks ?? found.checks);
  if (checks === 'true') warnings.push("checks is 'true': nothing is checked before a push; put the site's test command there");
  const deployTest = await field("The pipeline job that puts main on the test domain", existing?.deploy.test ?? found.deploy.test ?? DEFAULT_DEPLOY.test);
  const deployProduction = await field('The pipeline job that puts a release tag on production', existing?.deploy.production ?? found.deploy.production ?? DEFAULT_DEPLOY.production);
  const versionIn = await field("The version policy (aifactory, patch)", typeof existing?.version === 'string' ? existing.version : found.version);
  const testUrl = await value('test-url', 'What the test domain serves (URL)', existing?.urls.test);
  const productionUrl = await value('production-url', 'What production serves (URL)', existing?.urls.production ?? found.homepage);
  const layout = await field('Where the rest of the site is, one line for the model (optional)', existing?.layout ?? found.layout, { required: false });
  const config = validateConfig({
    brand: existing?.brand.name === brandName ? existing.brand : { name: brandName },
    editable,
    ...(layout ? { layout } : {}),
    exclude: existing?.exclude,
    build: { command: buildCommand, output: buildOutput, ...(describe ? { describe } : {}) },
    checks,
    version: versionIn,
    urls: { test: testUrl, production: productionUrl },
    deploy: { test: deployTest, production: deployProduction },
  });

  // 5. The bot's address.
  const botUrl = (await value('url', 'The bot as the browser reaches it', current.CONTENT_BOT_URL || found.botUrl)).replace(/\/$/, '');
  let urlPort = '';
  try { urlPort = new URL(botUrl).port; } catch { throw new WizardError(`${botUrl} is not a URL`); }
  // The port in the URL is the host port; without one (a reverse proxy in front) it is asked.
  const port = urlPort || await value('port', 'The host port the container publishes (a proxy forwards to it)', current.CONTENT_BOT_HOST_PORT || '8290');
  if (!/^\d+$/.test(port)) throw new WizardError(`the port is a number, not ${JSON.stringify(port)}`);
  const callback = `${botUrl}/auth/callback`;

  // 6. The OAuth application.
  const base = platformUrl || 'https://github.com';
  ask.note(platform === 'gitlab'
    ? `\nThe OAuth application, on GitLab, once:\n  ${base}/groups/${project.split('/').slice(0, -1).join('/')}/-/settings/applications (the project's group), or your own\n  ${base}/-/user_settings/applications\n  Name: Content Bot · Redirect URI: ${callback} · Confidential: yes · Scopes: read_user`
    : `\nThe OAuth App, on GitHub, once:\n  ${base}/settings/developers → OAuth Apps → New OAuth App (or your organisation's Settings → Developer settings)\n  Name: Content Bot · Homepage: ${botUrl} · Authorization callback URL: ${callback}`);
  const oauthId = await value('oauth-id', platform === 'gitlab' ? 'Its Application ID' : 'Its Client ID', current.CONTENT_BOT_OAUTH_ID || undefined);
  const oauthSecret = await value('oauth-secret', 'Its secret', env.CONTENT_BOT_OAUTH_SECRET || current.CONTENT_BOT_OAUTH_SECRET || undefined, { secret: true });

  // 7. The token.
  ask.note(platform === 'gitlab'
    ? `\nThe bot's token: a project access token of ${project} (Settings → Access tokens), role Maintainer, scopes api, write_repository (read_api is in api).`
    : `\nThe bot's token: a fine-grained token on ${project} with Contents read and write, Actions read, Metadata read (Settings → Developer settings → Personal access tokens), or a classic token with repo.`);
  let token = '';
  let unverified = false;
  for (;;) {
    token = await value('token', 'The token', env.CONTENT_BOT_TOKEN || current.CONTENT_BOT_TOKEN || undefined, { secret: true, required: false });
    if (!token) {
      if (yes) throw new WizardError('--yes needs CONTENT_BOT_TOKEN in the environment (or --token)');
      ask.note('A token is needed here.');
      continue;
    }
    const platformApi = createPlatform(platform, { url: base, project, token, clientId: oauthId, secret: oauthSecret, redirectUri: callback, fetchImpl });
    try {
      const said = await verify({ platformName: platform, platform: platformApi, url: base, project, token, repoUrl, fetchImpl, exec, askpass });
      ask.note(`  token ok: ${said.join('; ')}`);
      break;
    } catch (error) {
      const reason = String(error?.message ?? error).split('\n')[0];
      if (yes) throw new WizardError(`the token was refused: ${reason}`);
      ask.note(`  the token was refused: ${reason}`);
      const again = await ask.secret('The token again (Enter keeps this one unverified): ');
      if (!again) { unverified = true; warnings.push(`the token was written unverified: ${reason}`); break; }
      given.token = again;
    }
  }
  void unverified;

  // 8. The optional settings.
  const minAccess = await value('min-access', `The access a person needs (30 = ${accessName(platform, '30')}, 40 = ${accessName(platform, '40')})`, current.CONTENT_BOT_MIN_ACCESS || '30');
  if (!/^\d+$/.test(minAccess)) throw new WizardError(`the access is a number, not ${JSON.stringify(minAccess)}`);
  const llmIn = (await value('llm', `The language model CLI (${LLM_NAMES.join(', ')})`, current.CONTENT_BOT_LLM || 'claude')).toLowerCase();
  if (!LLM_NAMES.includes(llmIn as LlmName)) throw new WizardError(`the language model CLI is ${LLM_NAMES.join(' or ')}, not ${JSON.stringify(llmIn)}`);
  const llm = llmIn as LlmName;
  // The model: what was written for this CLI, else its default (codex: its own, empty).
  const keptModel = (current.CONTENT_BOT_LLM || 'claude') === llm ? current.CONTENT_BOT_MODEL : undefined;
  const model = await value('model', llm === 'codex' ? "The model (empty: codex's default)" : 'The model', keptModel || LLMS[llm].defaultModel || undefined, { required: false });

  // 9. Written.
  const settings: Settings = {
    CONTENT_BOT_REPO_URL: repoUrl,
    CONTENT_BOT_PLATFORM: platform,
    CONTENT_BOT_PLATFORM_URL: platformUrl,
    CONTENT_BOT_PROJECT: project,
    CONTENT_BOT_TOKEN: token,
    CONTENT_BOT_URL: botUrl,
    CONTENT_BOT_OAUTH_ID: oauthId,
    CONTENT_BOT_OAUTH_SECRET: oauthSecret,
    CONTENT_BOT_ENGINE: engine ?? '',
    CONTENT_BOT_MIN_ACCESS: minAccess,
    CONTENT_BOT_LLM: llm,
    CONTENT_BOT_MODEL: model,
    CONTENT_BOT_HOST_PORT: port,
  };
  const written: string[] = [];
  const kept: string[] = [];
  writeFileSync(configFile, configSource(config));
  written.push(CONFIG_FILE);
  for (const [target, source, fill] of [
    ['tools/content-bot/Dockerfile', 'Dockerfile', (text: string) => text.replace('{{version}}', version)],
    ['tools/content-bot/compose.yaml', 'compose.yaml', (text: string) => text],
  ] as [string, string, (text: string) => string][]) {
    const path = join(dir, target);
    if (existsSync(path)) { kept.push(target); continue; }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, fill(readFileSync(join(templates, source), 'utf8')));
    written.push(target);
  }
  writeEnv(envFile, settings);
  written.push(ENV_FILE);
  if (ignoreEnv(dir)) written.push('.gitignore (+ tools/content-bot/.env)');

  // 10. The summary.
  ask.note('');
  for (const file of written) ask.note(`written  ${file}`);
  for (const file of kept) ask.note(`kept     ${file}`);
  for (const warning of warnings) ask.note(`warning  ${warning}`);
  ask.note(`\nNext: commit ${CONFIG_FILE} and tools/content-bot/{Dockerfile,compose.yaml} (not .env), then:`);
  const runner = engine && engine !== 'docker' ? 'podman' : 'docker';
  ask.note(`  ${engine ? composeCommand(engine).join(' ') : 'docker compose'} -f tools/content-bot/compose.yaml up -d --build`);
  ask.note(`  ${runner} exec -it site-content-bot ${LLMS[llm].login}`);
  ask.note(`  ${runner} exec -it site-content-bot site-content-bot check`);
  ask.note(`The bot will be at ${botUrl} (host port ${port}); log in with ${platform === 'gitlab' ? 'GitLab' : 'GitHub'}.`);
  return { written, kept, settings, config, engine, warnings };
};
