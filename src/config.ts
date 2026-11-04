// The site's description of itself: content-bot.config.mjs at the root of its
// repository (RQ-0001). Everything the bot needs to know about *the site*
// (which files hold its texts, how it builds, what its checks are, how its
// version is formed, its name) is here; where the bot runs and its secrets
// stay in the environment (cli.ts).
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_FILE = 'content-bot.config.mjs';
export const DEFAULT_EXCLUDE = ['runs', 'handoffs', '.factory'];
export const KINDS = ['text', 'svg-text'] as const;
export const POLICY_NAMES = ['aifactory', 'patch'] as const;

export type Kind = (typeof KINDS)[number];
export type PolicyName = (typeof POLICY_NAMES)[number];

export interface EditableEntry {
  path?: string;
  glob?: string;
  kind: Kind;
  rule?: string;
}

export interface VersionInput {
  candidate: string;
  production: { tag: string; commit: string } | null;
  read: (path: string) => Promise<string | undefined>;
}
export type VersionFunction = (input: VersionInput) => string | Promise<string>;

export interface Config {
  brand: { mark: string; name: string; title: string; subtitle: string };
  editable: EditableEntry[];
  layout?: string;
  exclude: string[];
  build: { command: string; output: string; describe?: string };
  checks: string;
  version: PolicyName | VersionFunction;
  urls: { test: string; production: string };
  // The deploy jobs of the site's pipeline: test puts main on the test
  // domain, production a release tag on production.
  deploy: { test: string; production: string };
}

export const DEFAULT_DEPLOY = { test: 'deploy_linux', production: 'deploy_release' };

const TOP_LEVEL = ['brand', 'editable', 'layout', 'exclude', 'build', 'checks', 'version', 'urls', 'deploy'];

export class ConfigError extends Error {}

const fail = (field: string, what: string): never => {
  throw new ConfigError(`${CONFIG_FILE}: ${field} ${what}`);
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, field: string, { optional = false } = {}): string | undefined => {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.trim()) fail(field, 'must be a non-empty string');
  return value as string;
};

// A relative path inside the repository: no leading /, no .. segment, no empty segment.
export const plainPath = (value: string): boolean => value !== '' && !value.startsWith('/') && !value.split('/').some((segment) => segment === '' || segment === '..');

// The initials of a name, for the brand mark: "Example site" -> "ES".
const initials = (name: string): string => name.split(/[\s-]+/).filter(Boolean).map((word) => word[0]!.toUpperCase()).slice(0, 3).join('') || 'CB';

// The object a config file exports, checked field by field, with the defaults filled.
export const validateConfig = (raw: unknown): Config => {
  if (!isObject(raw)) fail('default export', 'must be an object');
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!TOP_LEVEL.includes(key)) fail(key, `is not a field (the fields are ${TOP_LEVEL.join(', ')})`);

  if (!isObject(input.brand)) fail('brand', 'must be an object with at least name');
  const brandIn = input.brand as Record<string, unknown>;
  for (const key of Object.keys(brandIn)) if (!['mark', 'name', 'title', 'subtitle'].includes(key)) fail(`brand.${key}`, 'is not a field (mark, name, title, subtitle)');
  const name = text(brandIn.name, 'brand.name')!;
  const brand = {
    name,
    mark: text(brandIn.mark, 'brand.mark', { optional: true }) ?? initials(name),
    title: text(brandIn.title, 'brand.title', { optional: true }) ?? 'Content Bot',
    subtitle: text(brandIn.subtitle, 'brand.subtitle', { optional: true }) ?? `The ${name}'s texts`,
  };

  if (!Array.isArray(input.editable) || !input.editable.length) fail('editable', 'must be a non-empty list of { path | glob, kind, rule? }');
  const editable = (input.editable as unknown[]).map((entry, index): EditableEntry => {
    const field = `editable[${index}]`;
    if (!isObject(entry)) fail(field, 'must be an object');
    const item = entry as Record<string, unknown>;
    for (const key of Object.keys(item)) if (!['path', 'glob', 'kind', 'rule'].includes(key)) fail(`${field}.${key}`, 'is not a field (path, glob, kind, rule)');
    if ((item.path === undefined) === (item.glob === undefined)) fail(field, 'must have either path or glob');
    const path = text(item.path, `${field}.path`, { optional: true });
    const glob = text(item.glob, `${field}.glob`, { optional: true });
    if (path !== undefined && !plainPath(path)) fail(`${field}.path`, 'must be a relative path without .. segments');
    if (glob !== undefined && !plainPath(glob)) fail(`${field}.glob`, 'must be a relative pattern without .. segments');
    if (!KINDS.includes(item.kind as Kind)) fail(`${field}.kind`, `must be one of ${KINDS.join(', ')}`);
    const rule = text(item.rule, `${field}.rule`, { optional: true });
    return { ...(path !== undefined ? { path } : { glob }), kind: item.kind as Kind, ...(rule !== undefined && item.kind === 'text' ? { rule } : {}) };
  });

  const layout = text(input.layout, 'layout', { optional: true });

  let exclude = DEFAULT_EXCLUDE;
  if (input.exclude !== undefined) {
    if (!Array.isArray(input.exclude) || !input.exclude.every((item) => typeof item === 'string' && plainPath(item))) fail('exclude', 'must be a list of relative paths without .. segments');
    exclude = input.exclude as string[];
  }

  if (!isObject(input.build)) fail('build', 'must be an object { command, output, describe? }');
  const buildIn = input.build as Record<string, unknown>;
  for (const key of Object.keys(buildIn)) if (!['command', 'output', 'describe'].includes(key)) fail(`build.${key}`, 'is not a field (command, output, describe)');
  const output = text(buildIn.output, 'build.output')!;
  if (!plainPath(output)) fail('build.output', 'must be a relative path without .. segments');
  const build = { command: text(buildIn.command, 'build.command')!, output, ...(buildIn.describe !== undefined ? { describe: text(buildIn.describe, 'build.describe')! } : {}) };

  const checks = text(input.checks, 'checks')!;

  let version: Config['version'] = 'aifactory';
  if (input.version !== undefined) {
    if (typeof input.version === 'function') version = input.version as VersionFunction;
    else if (POLICY_NAMES.includes(input.version as PolicyName)) version = input.version as PolicyName;
    else fail('version', `must be one of ${POLICY_NAMES.join(', ')} or a function`);
  }

  if (!isObject(input.urls)) fail('urls', 'must be an object { test, production }');
  const urlsIn = input.urls as Record<string, unknown>;
  for (const key of Object.keys(urlsIn)) if (!['test', 'production'].includes(key)) fail(`urls.${key}`, 'is not a field (test, production)');
  const urls = { test: text(urlsIn.test, 'urls.test')!, production: text(urlsIn.production, 'urls.production')! };
  for (const [key, value] of Object.entries(urls)) if (!/^https?:\/\//.test(value)) fail(`urls.${key}`, 'must be an http(s) URL');

  let deploy = DEFAULT_DEPLOY;
  if (input.deploy !== undefined) {
    if (!isObject(input.deploy)) fail('deploy', 'must be an object { test, production }');
    const deployIn = input.deploy as Record<string, unknown>;
    for (const key of Object.keys(deployIn)) if (!['test', 'production'].includes(key)) fail(`deploy.${key}`, 'is not a field (test, production)');
    deploy = { test: text(deployIn.test, 'deploy.test')!, production: text(deployIn.production, 'deploy.production')! };
  }

  return { brand, editable, ...(layout !== undefined ? { layout } : {}), exclude, build, checks, version, urls, deploy };
};

let loads = 0;

// Loads and validates the config file at path (absolute, or relative to cwd).
export const loadConfig = async (path: string): Promise<Config> => {
  const file = isAbsolute(path) ? path : resolve(path);
  if (!existsSync(file)) throw new ConfigError(`${file} does not exist`);
  let loaded: { default?: unknown };
  try {
    // The query keeps Node from handing back an earlier load of the same path.
    loaded = await import(`${pathToFileURL(file).href}?load=${++loads}`);
  } catch (error) {
    throw new ConfigError(`${file} could not be loaded: ${String(error?.message ?? error).split('\n')[0]}`);
  }
  if (!('default' in loaded)) throw new ConfigError(`${file} has no default export`);
  return validateConfig(loaded.default);
};
