// The bot's own clone of the site's repository. Every change starts from
// origin/main as it is now (fetch, hard reset, clean), so a change never builds
// on a stale tree, and ends as one commit pushed to main.
import { execFile, type ExecFileOptions } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const BOT_TRAILER = 'Content-bot';

export interface BotChange { sha: string; subject: string; author: string; date: string; kind: string; reverts?: string; undone: boolean }
export interface Commit { sha: string; subject: string; author: string }

const exec = (command: string, args: string[], options: ExecFileOptions): Promise<string> => new Promise((resolve, reject) => {
  execFile(command, args, { maxBuffer: 32 * 1024 * 1024, ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) {
      Object.assign(error, { stdout, stderr });
      return reject(error);
    }
    resolve(String(stdout));
  });
});

export class Repo {
  dir: string;
  url: string;
  branch: string;
  env: NodeJS.ProcessEnv;

  // url: the remote (a token, when there is one, comes from GIT_ASKPASS, never the URL);
  // env: extra environment for git (GIT_ASKPASS and its variable).
  constructor({ dir, url, branch = 'main', env = {} }: { dir: string; url: string; branch?: string; env?: NodeJS.ProcessEnv }) {
    this.dir = dir;
    this.url = url;
    this.branch = branch;
    this.env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env };
  }

  git(args: string[], options: ExecFileOptions = {}): Promise<string> {
    return exec('git', args, { cwd: this.dir, env: this.env, ...options });
  }

  async sync(): Promise<string> {
    if (!existsSync(`${this.dir}/.git`)) {
      mkdirSync(dirname(this.dir), { recursive: true });
      await exec('git', ['clone', '--branch', this.branch, this.url, this.dir], { env: this.env });
    }
    await this.git(['fetch', '--prune', 'origin', this.branch]);
    await this.git(['checkout', '-q', '-B', this.branch, `origin/${this.branch}`]);
    await this.git(['reset', '-q', '--hard', `origin/${this.branch}`]);
    // node_modules/ is ignored and kept: the checks reuse it.
    await this.git(['clean', '-q', '-fd']);
    return (await this.git(['rev-parse', 'HEAD'])).trim();
  }

  // Brings origin/main up to date without touching the working tree.
  async fetch(): Promise<string | void> {
    if (!existsSync(`${this.dir}/.git`)) return this.sync();
    await this.git(['fetch', '--prune', 'origin', this.branch]);
  }

  async changedFiles(): Promise<string[]> {
    const status = await this.git(['status', '--porcelain', '--untracked-files=all']);
    return status.split('\n').filter(Boolean).map((line) => line.slice(3));
  }

  async commit({ name, email, subject, body }: { name: string; email: string; subject: string; body: string }): Promise<string> {
    await this.git(['add', '-A']);
    await this.git([
      '-c', 'user.name=content-bot', '-c', 'user.email=content-bot@localhost',
      'commit', '-q', '--author', `${name} <${email}>`, '-m', subject, '-m', body,
    ]);
    return (await this.git(['rev-parse', 'HEAD'])).trim();
  }

  async push(): Promise<void> {
    await this.git(['push', '-q', 'origin', `HEAD:refs/heads/${this.branch}`]);
  }

  // The bot's commits on main, newest first: { sha, subject, author, date, kind
  // ('yes' or 'undo'), reverts, undone }. undone: a later bot commit reverted it.
  async botChanges(limit = Infinity): Promise<BotChange[]> {
    const args = ['log', `--grep=^${BOT_TRAILER}: `, '--format=%H%x1f%s%x1f%an%x1f%aI%x1f%(trailers:key=Content-bot,valueonly)%x1f%(trailers:key=Reverts,valueonly)%x1e'];
    const log = await this.git([...args, `origin/${this.branch}`]);
    const undone = new Set<string>();
    const changes: BotChange[] = [];
    for (const entry of log.split('\x1e').map((item) => item.trim()).filter(Boolean)) {
      const [sha, subject, author, date, kind, reverts] = entry.split('\x1f').map((field) => field.trim()) as string[];
      if (kind === 'undo' && reverts) undone.add(reverts);
      if (kind === 'yes' || kind === 'undo') changes.push({ sha: sha!, subject: subject!, author: author!, date: date!, kind, reverts: reverts || undefined, undone: kind === 'yes' && undone.has(sha!) });
      if (changes.length >= limit) break;
    }
    return changes;
  }

  // The newest bot change on main that no later bot commit has undone.
  async latestBotChange(): Promise<{ sha: string; subject: string } | undefined> {
    const change = (await this.botChanges()).find((entry) => entry.kind === 'yes' && !entry.undone);
    return change && { sha: change.sha, subject: change.subject };
  }

  // A file as it is at a commit (undefined when it is not there).
  async show(ref: string, path: string): Promise<string | undefined> {
    try { return await this.git(['show', `${ref}:${path}`]); } catch { return undefined; }
  }

  // The tree of a commit or tag, written into dir (which must not exist yet).
  async archive(ref: string, dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    await exec('sh', ['-c', 'git archive --format=tar "$1" | tar -x -C "$2"', 'sh', ref, dir], { cwd: this.dir, env: this.env });
  }

  async fetchTag(tag: string): Promise<void> {
    await this.git(['fetch', '-q', '--no-tags', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`]);
  }

  // Whether ref holds commit sha.
  async contains(ref: string, sha: string): Promise<boolean> {
    try {
      await this.git(['merge-base', '--is-ancestor', sha, ref]);
      return true;
    } catch (error) {
      if (error.code === 1) return false;
      throw error;
    }
  }

  // The commits of a range ('a..b'), newest first, merges left out: { sha, subject, author }.
  async commits(range: string): Promise<Commit[]> {
    const log = await this.git(['log', '--no-merges', '--format=%H%x1f%s%x1f%an%x1e', range]);
    return log.split('\x1e').map((item) => item.trim()).filter(Boolean).map((entry) => {
      const [sha, subject, author] = entry.split('\x1f') as string[];
      return { sha: sha!, subject: subject!, author: author! };
    });
  }

  // How many commits main has that ref has not.
  async ahead(ref: string): Promise<number> {
    return Number((await this.git(['rev-list', '--count', `${ref}..origin/${this.branch}`])).trim());
  }

  async revert(sha: string): Promise<void> {
    try {
      await this.git(['revert', '--no-commit', sha]);
    } catch (error) {
      await this.git(['revert', '--abort']).catch(() => {});
      throw new Error(`the change cannot be undone cleanly (a later edit touched the same text): ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    }
  }
}
