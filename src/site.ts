// What Claude reads for a request: copies of the site, each made once and never
// changed afterwards, so an Apply that resets the clone never moves the ground
// under a request that is still reading.
//
//   <root>/main/<sha>/         the tree of main at that commit (git archive)
//   <root>/test/<sha>/         the release built from it: what the test domain serves
//   <root>/production/<tag>/   the tree of the latest GitLab Release's tag
//
// The bot calls context() under its lock, right after the clone's sync.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_EXCLUDE } from './config.js';
import type { Release } from './gitlab.js';
import type { Repo } from './repo.js';

const RELEASE_TTL_MS = 60_000;

const shell = (command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> => new Promise((resolve, reject) => {
  execFile('sh', ['-c', command], { cwd, env, maxBuffer: 32 * 1024 * 1024, timeout: 600_000, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) return reject(new Error(`${stdout}\n${stderr}`.trim().split('\n').slice(-8).join('\n') || error.message));
    resolve(String(stdout));
  });
});

const short = (error: unknown): string => String((error as Error)?.message ?? error).split('\n')[0]!.slice(0, 300);

export type Production = (Release & { ahead: number; dir?: string; error?: string; version?: unknown }) | { error: string } | null;

export interface Context {
  sha: string;
  main: string;
  test?: string;
  testError?: string;
  production: Production;
}

export interface SiteOptions {
  repo: Repo;
  root: string;
  // The shell command that turns a copy of main into build.output, run in
  // that copy with CLONE set to the clone (whose node_modules it may use).
  build: { command: string; output: string };
  latestRelease: () => Promise<Release | null>;
  exclude?: string[];
  keep?: number;
}

export class Site {
  repo: Repo;
  root: string;
  build: { command: string; output: string };
  latestRelease: () => Promise<Release | null>;
  exclude: string[];
  keep: number;
  releaseCache: { at: number; release?: Release | null; error?: string } | undefined;

  constructor({ repo, root, build, latestRelease, exclude = DEFAULT_EXCLUDE, keep = 3 }: SiteOptions) {
    this.repo = repo;
    this.root = root;
    this.build = build;
    this.latestRelease = latestRelease;
    this.exclude = exclude;
    this.keep = keep;
    this.releaseCache = undefined;
  }

  // Writes a copy by making it beside its place and renaming it into place.
  async make(kind: string, name: string, fill: (dir: string) => Promise<void>): Promise<string> {
    const dir = join(this.root, kind, name);
    if (existsSync(dir)) return dir;
    const scratch = join(this.root, 'scratch', `${kind}-${randomBytes(6).toString('hex')}`);
    mkdirSync(join(this.root, 'scratch'), { recursive: true });
    try {
      await fill(scratch);
      mkdirSync(join(this.root, kind), { recursive: true });
      renameSync(scratch, dir);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    this.prune(kind, name);
    return dir;
  }

  // Keeps the newest copies of a kind; a request still reading an older one
  // has had minutes to finish.
  prune(kind: string, current: string): void {
    const dir = join(this.root, kind);
    const names = readdirSync(dir)
      .filter((name) => name !== current)
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const { name } of names.slice(this.keep - 1)) rmSync(join(dir, name), { recursive: true, force: true });
  }

  async tree(ref: string, dir: string): Promise<void> {
    await this.repo.archive(ref, dir);
    for (const name of this.exclude) rmSync(join(dir, name), { recursive: true, force: true });
  }

  main(sha: string): Promise<string> {
    return this.make('main', sha, (dir) => this.tree(sha, dir));
  }

  test(sha: string, mainDir: string): Promise<string> {
    return this.make('test', sha, async (dir) => {
      const work = `${dir}-build`;
      try {
        await shell('cp -R "$SOURCE" "$WORK"', this.root, { ...process.env, SOURCE: mainDir, WORK: work });
        await shell(this.build.command, work, { ...process.env, CLONE: this.repo.dir });
        const output = join(work, this.build.output);
        if (!existsSync(output) || !statSync(output).isDirectory()) throw new Error(`the build left no ${this.build.output}/ directory`);
        renameSync(output, dir);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });
  }

  // The latest GitLab Release, asked at most once a minute.
  async release(): Promise<Release | null | undefined> {
    const now = Date.now();
    if (!this.releaseCache || now - this.releaseCache.at > RELEASE_TTL_MS) {
      const at = now;
      try {
        const release = await this.latestRelease();
        if (release && !/^[\w.+-]+(?:\/[\w.+-]+)*$/.test(release.tag)) throw new Error(`the release tag '${release.tag}' is not a plain name`);
        if (release) await this.repo.fetchTag(release.tag);
        this.releaseCache = { at, release };
      } catch (error) {
        this.releaseCache = { at, error: short(error) };
      }
    }
    if (this.releaseCache.error) throw new Error(this.releaseCache.error);
    return this.releaseCache.release;
  }

  // { tag, commit, ahead }, or { error } when it cannot be told; null with no release.
  async production(): Promise<Production> {
    try {
      const release = await this.release();
      if (!release) return null;
      return { ...release, ahead: await this.repo.ahead(release.tag) };
    } catch (error) {
      return { error: short(error) };
    }
  }

  // Everything for one request, on the clone as the last sync left it:
  // { sha, main, test | testError, production: { tag, commit, ahead, dir } | { error } | null }.
  async context(): Promise<Context> {
    const sha = (await this.repo.git(['rev-parse', 'HEAD'])).trim();
    const context: Context = { sha, main: await this.main(sha), production: null };
    try {
      context.test = await this.test(sha, context.main);
    } catch (error) {
      context.testError = short(error);
    }
    const production = await this.production();
    if (production && !('error' in production && production.error)) {
      const found = production as Release & { ahead: number; dir?: string; error?: string };
      try {
        found.dir = await this.make('production', found.tag.replace(/\//g, '__'), (dir) => this.tree(found.tag, dir));
      } catch (error) {
        found.error = short(error);
      }
    }
    context.production = production;
    return context;
  }
}
