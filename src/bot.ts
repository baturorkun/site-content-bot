// What the chat does, apart from HTTP: a request becomes a proposal (nothing is
// written), Apply turns the proposal into one commit on main, Undo reverts the
// latest bot change. The clone is touched under one lock, so a sync, an Apply
// and an Undo never run on it at the same time; Claude itself reads copies
// (site.ts) and runs outside the lock.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { User } from './auth.js';
import type { Ask } from './claude.js';
import type { Config } from './config.js';
import { applyFileEdits, Editable, type Edit } from './edits.js';
import type { DeployState } from './gitlab.js';
import { BOT_TRAILER, type BotChange, type Repo } from './repo.js';
import type { Context, Site } from './site.js';
import { onlyTextChanged } from './svg.js';
import { nextVersion, VERSION, versionPolicy, type VersionPolicy } from './version.js';

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    summary: { type: 'string' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, where: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } },
        required: ['file', 'where', 'old', 'new'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'summary', 'edits'],
  additionalProperties: false,
};

const HISTORY_TURNS = 10;
const CHANGES_SHOWN = 15;
// Who may release: Maintainer and above, as GitLab's protected v* tags allow.
export const RELEASE_ACCESS = 40;

const version = (tag: string | undefined) => tag?.match(VERSION)?.slice(1).map(Number);
const newer = (a: string, b: string | undefined): boolean => {
  const [x, y] = [version(a), version(b)];
  if (!x) return false;
  if (!y) return true;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
};

export interface Turn { role: 'user' | 'assistant'; text: string }
export interface Proposal { id: string; chatId: string; request: string; summary: string; edits: Edit[] }
export interface Session { user: User; chats: Map<string, Turn[]>; proposal: Proposal | undefined }

const instructions = (config: Config, editable: Editable): string => `You are ${config.brand.title}. You answer questions about the ${config.brand.name} and change
its texts. You read the site with Read, Glob and Grep (absolute paths, in the
directories below); you cannot write, run commands or browse. Answer only with
the JSON asked for.

Reading:
- Look before you answer. Search (Grep, case-insensitive for a word) instead of
  guessing. A text you say is on the site must be one you found: quote it and
  give its path. If you did not find something, say so; never name a text you
  did not see.
- "Where does X appear" covers the texts, the drawings (SVG), the built pages
  and, when asked or when they differ, production; say where they differ.

Replying ("reply"):
- In the language of the user's latest message. Short. No preamble ("I'll
  look…", "Let me…", "Sure"): start with the answer. Markdown is fine (lists,
  **bold**, \`code\`).

Changing ("edits"):
- You may change only:
${editable.describe()}
- File names, code, styles, layout, new sections and raster images are out of
  reach: return no edits and say so.
- Each edit: { "file": its path relative to MAIN, "where": a short label for
  people (e.g. "TR · Products · 09 title", "Drawing · simics-models"), "old":
  a piece of MAIN's current file, copied exactly, that occurs exactly once in
  it (short but unique), "new": what it becomes }.
- When a text is changed in one language, change the other language only if
  the user asks for it. A question gets no edits. When it is unclear which
  text is meant, ask in "reply" and return no edits.
- "summary": the change in a few English words, for the commit message ("" when
  there are no edits).`;

const directories = (context: Context, config: Config, editable: Editable): string => {
  const texts = editable.entries.map((entry) => entry.path ?? entry.glob).join(', ');
  const lines = [
    `- MAIN = ${context.main}: the repository on main as it is now (commit ${context.sha.slice(0, 8)}). Editable: ${texts}${config.layout ? `; ${config.layout}` : ''}.`,
    context.test
      ? `- TEST = ${context.test}: the built site that ${config.urls.test} serves for that commit${config.build.describe ? `: ${config.build.describe}` : ''}.`
      : `- TEST: not available (${context.testError}); read MAIN instead.`,
  ];
  const production = context.production as any;
  if (production?.dir) {
    lines.push(`- PRODUCTION = ${production.dir}: the sources of release ${production.tag} (commit ${production.commit.slice(0, 8)}), what ${config.urls.production} serves; main is ${production.ahead} commit(s) ahead of it.`);
  } else {
    lines.push(`- PRODUCTION: not available (${production === null ? 'there is no GitLab Release yet' : production?.error ?? 'unknown'}).`);
  }
  return lines.join('\n');
};

const prompt = ({ history, message, context, config, editable }: { history: Turn[]; message: string; context: Context; config: Config; editable: Editable }): string => [
  instructions(config, editable),
  `\nThe directories (read-only copies):\n${directories(context, config, editable)}`,
  history.length ? `\nThe conversation so far:\n${history.map((turn) => `${turn.role}: ${turn.text}`).join('\n')}` : '',
  `\nThe user's request now:\n${message}`,
].join('\n');

const runChecks = (command: string, cwd: string): Promise<{ ok: boolean; output?: string }> => new Promise((resolve) => {
  execFile('sh', ['-c', command], { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 600_000, encoding: 'utf8' }, (error, stdout, stderr) => {
    resolve(error ? { ok: false, output: `${stdout}\n${stderr}`.trim().split('\n').slice(-15).join('\n') } : { ok: true });
  });
});

// A chat's recent turns; a session holds one per chat id the page sends.
const chatHistory = (session: Session, chatId: string): Turn[] => {
  session.chats ??= new Map();
  if (!session.chats.has(chatId)) session.chats.set(chatId, []);
  return session.chats.get(chatId)!;
};

export interface Releases {
  // The newest green main commit, what a release ships.
  candidate: () => Promise<{ sha: string; pipeline: string } | null>;
  create: (release: { tag: string; ref: string; name: string; description: string }) => Promise<{ tag: string; url: string }>;
  // The tag pipeline's state.
  state: (tag: string) => Promise<DeployState>;
}

export interface ContentBotOptions {
  repo: Repo;
  ask: Ask;
  site: Site;
  config: Config;
  deploy?: (sha: string) => Promise<DeployState>;
  releases: Releases;
}

export class ContentBot {
  repo: Repo;
  ask: Ask;
  site: Site;
  config: Config;
  editable: Editable;
  checks: string;
  policy: VersionPolicy;
  deploy: (sha: string) => Promise<DeployState>;
  releases: Releases;
  urls: { testUrl: string; prodUrl: string };
  busy: Promise<unknown>;
  finalStates: Map<string, { state: string; pipeline?: string }>;

  // ask: (prompt, schema, dirs) => answer; config: the site's (config.ts), with
  // its checks (a shell command run in the clone), its editable files, its
  // URLs and its version policy; site: site.ts; deploy: (sha) => the pipeline
  // state (gitlab.ts); releases: candidate/create/state (above).
  constructor({ repo, ask, site, config, deploy = async () => ({ state: 'unknown' }), releases }: ContentBotOptions) {
    this.repo = repo;
    this.ask = ask;
    this.site = site;
    this.config = config;
    this.editable = new Editable(config.editable);
    this.checks = config.checks;
    this.policy = versionPolicy(config.version);
    this.deploy = deploy;
    this.releases = releases;
    this.urls = { testUrl: config.urls.test, prodUrl: config.urls.production };
    this.busy = Promise.resolve();
    this.finalStates = new Map();
  }

  // Runs one task on the clone after the one before it has finished.
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.busy.then(task, task);
    this.busy = next.catch(() => {});
    return next;
  }

  async propose(session: Session, message: string, chatId = 'default'): Promise<{ reply: string; proposal?: Proposal; error?: string }> {
    const history = chatHistory(session, chatId);
    const context = await this.exclusive(async () => {
      await this.repo.sync();
      return this.site.context();
    });
    const dirs = [context.main, context.test, (context.production as any)?.dir].filter(Boolean) as string[];
    const answer = await this.ask(prompt({ history: history.slice(-HISTORY_TURNS), message, context, config: this.config, editable: this.editable }), ANSWER_SCHEMA, dirs);
    const edits: Edit[] = Array.isArray(answer.edits) ? answer.edits : [];
    history.push({ role: 'user', text: message }, { role: 'assistant', text: answer.reply });
    if (!edits.length) {
      session.proposal = undefined;
      return { reply: answer.reply };
    }
    // Checked now, on the copy Claude read, so a proposal that cannot apply is never shown as one.
    try {
      applyFileEdits((file) => readFileSync(join(context.main, file), 'utf8'), edits, this.editable);
    } catch (error) {
      session.proposal = undefined;
      return { reply: answer.reply, error: `The proposed change does not fit (${error.message}); please ask again, more precisely.` };
    }
    session.proposal = { id: randomUUID(), chatId, request: message, summary: String(answer.summary ?? '').trim() || 'text change', edits };
    return { reply: answer.reply, proposal: session.proposal };
  }

  discard(session: Session): void {
    session.proposal = undefined;
  }

  // Applies the proposal on main as it is now, checks it and pushes it.
  apply(session: Session, id: string): Promise<{ sha: string }> {
    const proposal = session.proposal;
    if (!proposal || proposal.id !== id) return Promise.reject(new Error('there is no such proposal (it was discarded or replaced)'));
    return this.exclusive(async () => {
      const sha = await this.publish(session.user, `content: ${proposal.summary}`, `Request: ${proposal.request}`, async () => {
        const files = applyFileEdits((file) => readFileSync(join(this.repo.dir, file), 'utf8'), proposal.edits, this.editable);
        for (const [file, text] of files) writeFileSync(join(this.repo.dir, file), text);
      }, { kind: 'yes' });
      session.proposal = undefined;
      chatHistory(session, proposal.chatId).push({ role: 'assistant', text: `(applied as ${sha.slice(0, 8)})` });
      return { sha };
    });
  }

  async undoable(): Promise<{ sha: string; subject: string } | undefined> {
    await this.exclusive(() => this.repo.sync());
    return this.repo.latestBotChange();
  }

  // Reverts the latest bot change, if it is still the one the user saw.
  undo(user: User, sha: string): Promise<{ sha: string }> {
    return this.exclusive(async () => {
      await this.repo.sync();
      const latest = await this.repo.latestBotChange();
      if (!latest || latest.sha !== sha) throw new Error('the latest bot change is no longer the one shown; look again');
      const subject = latest.subject.replace(/^content: /, '');
      return { sha: await this.publish(user, `content: undo "${subject}"`, `Reverts ${sha.slice(0, 8)}.`, () => this.repo.revert(sha), { kind: 'undo', reverts: sha }) };
    });
  }

  // Refuses a change that reaches past the site's texts: a file that is not
  // editable, a new or deleted drawing, a drawing whose markup changed.
  async guard(changed: string[]): Promise<void> {
    const outside = changed.filter((path) => !this.editable.isEditable(path));
    if (outside.length) throw new Error(`refused: the change touches ${outside.join(', ')}; ${this.editable.summary()}`);
    for (const path of changed.filter((file) => this.editable.isSvg(file))) {
      const before = await this.repo.show('HEAD', path);
      let after: string | undefined;
      try { after = readFileSync(join(this.repo.dir, path), 'utf8'); } catch { after = undefined; }
      if (before === undefined || after === undefined) throw new Error(`refused: ${path} would be added or removed; only a drawing's text may change`);
      if (!onlyTextChanged(before, after)) throw new Error(`refused: the change to ${path} reaches past its text (tags or attributes changed)`);
    }
  }

  // One commit on a fresh main: change, guard, checks, commit, push. A push that
  // loses a race with another commit on main is made again once on the new main.
  async publish(user: { name: string; email: string }, subject: string, body: string, change: () => void | Promise<void>, trailers: { kind: string; reverts?: string }): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      await this.repo.sync();
      await change();
      const changed = await this.repo.changedFiles();
      await this.guard(changed);
      if (!changed.length) throw new Error('the change leaves the files as they are');
      const checked = await runChecks(this.checks, this.repo.dir);
      if (!checked.ok) throw new Error(`the site's checks failed, nothing was pushed:\n${checked.output}`);
      const lines = [body, '', `Requested-by: ${user.name} <${user.email}>`, `${BOT_TRAILER}: ${trailers.kind}`];
      if (trailers.reverts) lines.push(`Reverts: ${trailers.reverts}`);
      const sha = await this.repo.commit({ name: user.name, email: user.email, subject, body: lines.join('\n') });
      try {
        await this.repo.push();
        return sha;
      } catch (error) {
        if (attempt >= 2) throw new Error(`the push to main failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
      }
    }
  }

  // Where a commit is: 'production' (in the latest release), 'test' (its
  // pipeline deployed it), 'failed', 'pipeline' or 'unknown'. Final pipeline
  // states are remembered.
  async deployState(sha: string): Promise<{ state: string; pipeline?: string }> {
    if (this.finalStates.has(sha)) return this.finalStates.get(sha)!;
    let result: DeployState;
    try { result = await this.deploy(sha); } catch { result = { state: 'unknown' }; }
    const state = ({ deployed: 'test', failed: 'failed', running: 'pipeline', waiting: 'pipeline' } as Record<string, string>)[result.state] ?? 'unknown';
    const entry = { state, pipeline: result.pipeline };
    if (state === 'test' || state === 'failed') this.finalStates.set(sha, entry);
    return entry;
  }

  // The recent bot commits with where each one is, and the one Undo would revert.
  async changes(): Promise<{ changes: any[]; undoable: string | null }> {
    const { list, latest } = await this.exclusive(async () => {
      await this.repo.fetch();
      const release = await this.site.release().catch(() => undefined);
      const marked: (BotChange & { inProduction: boolean })[] = [];
      for (const change of await this.repo.botChanges(CHANGES_SHOWN)) marked.push({ ...change, inProduction: Boolean(release) && await this.repo.contains(release!.tag, change.sha) });
      return { list: marked, latest: await this.repo.latestBotChange() };
    });
    const changes = await Promise.all(list.map(async ({ inProduction, ...change }) => {
      if (change.undone) return { ...change, state: 'undone' };
      if (inProduction) return { ...change, state: 'production' };
      return { ...change, ...(await this.deployState(change.sha)) };
    }));
    return { changes, undoable: latest?.sha ?? null };
  }

  // What a release would ship now: the newest main commit the test site
  // serves (its pipeline passed), the commits since production's tag, the
  // newer ones that would stay behind, and the next version.
  async releasePreview(user: User): Promise<any> {
    const candidate = await this.releases.candidate();
    const preview = await this.exclusive(async () => {
      await this.repo.fetch();
      const production = await this.site.production() as any;
      if (production?.error) throw new Error(`production's release cannot be read: ${production.error}`);
      if (!candidate) return { production, candidate: null, changes: [], pending: [], next: null, policy: this.policy.label };
      if (!(await this.repo.contains(`origin/${this.repo.branch}`, candidate.sha))) throw new Error(`the last green pipeline (${candidate.sha.slice(0, 8)}) is not on main`);
      const since = production ? `${production.tag}..${candidate.sha}` : candidate.sha;
      return {
        production,
        candidate,
        changes: (await this.repo.commits(since)).slice(0, 100),
        pending: await this.repo.commits(`${candidate.sha}..origin/${this.repo.branch}`),
        // Fixed, not chosen: the policy's version for this commit.
        next: await nextVersion(this.policy, { candidate: candidate.sha, production: production ? { tag: production.tag, commit: production.commit } : null, repo: this.repo }),
        policy: this.policy.label,
      };
    });
    // Nothing to release: production already runs this version or this commit.
    const unchanged = !preview.candidate ? null
      : preview.production?.tag === preview.next ? `No changes to release: production already runs ${preview.next}. ${this.policy.unchangedHint}`
        : !preview.changes.length ? `No changes to release: nothing has changed since ${preview.production.tag}.` : null;
    if (unchanged) return { ...preview, canRelease: false, unchanged, reason: unchanged };
    const allowed = (user.accessLevel ?? 0) >= RELEASE_ACCESS;
    return { ...preview, canRelease: allowed, ...(allowed ? {} : { reason: 'Only a Maintainer or Owner of the project can release.' }) };
  }

  // Makes the GitLab Release (and its tag) at the commit the user saw, titled
  // with its version; the tag pipeline then deploys it to production.
  async release(user: User, { tag, sha }: { tag?: string; sha?: string }): Promise<{ tag: string; url: string }> {
    if ((user.accessLevel ?? 0) < RELEASE_ACCESS) throw Object.assign(new Error('Only a Maintainer or Owner of the project can release.'), { status: 403 });
    if (!VERSION.test(tag ?? '')) throw Object.assign(new Error('The version must look like v1.2.3.'), { status: 400 });
    const preview = await this.releasePreview(user);
    if (!preview.candidate) throw new Error('No main pipeline has passed yet; there is nothing to release.');
    if (preview.candidate.sha !== sha) throw new Error('The test site has moved on since you looked; look again.');
    if (!preview.changes.length) throw new Error(`Nothing has changed since ${preview.production.tag}.`);
    if (tag !== preview.next) throw Object.assign(new Error(`The version is fixed: ${preview.next} (${this.policy.label}).`), { status: 400 });
    if (preview.production?.tag === tag) throw Object.assign(new Error(`${tag} is already in production. ${this.policy.unchangedHint}`), { status: 409 });
    if (preview.production && !newer(tag!, preview.production.tag)) throw Object.assign(new Error(`${tag} is not newer than ${preview.production.tag}, which production serves.`), { status: 400 });
    const description = [
      `Released from ${this.config.brand.title} by ${user.name} <${user.email}>.`,
      '',
      preview.production ? `Changes since ${preview.production.tag}:` : 'Changes:',
      '',
      ...preview.changes.map((change: { subject: string; author: string; sha: string }) => `- ${change.subject} (${change.author}, ${change.sha.slice(0, 8)})`),
    ].join('\n');
    const created = await this.releases.create({ tag: tag!, ref: sha!, name: tag!, description });
    this.site.releaseCache = undefined;
    return created;
  }

  // Where a release is: its tag pipeline's deploy to production.
  async releaseState(tag: string | null): Promise<DeployState> {
    if (!VERSION.test(tag ?? '')) throw Object.assign(new Error('The version must look like v1.2.3.'), { status: 400 });
    let result: DeployState;
    try { result = await this.releases.state(tag!); } catch { result = { state: 'unknown' }; }
    return result;
  }

  // The production release and main's lead over it, and the version of each
  // under the policy (when it has one), for the top bar and the sidebar.
  async status(): Promise<any> {
    const { production, main } = await this.exclusive(async () => {
      await this.repo.fetch();
      const production = await this.site.production() as any;
      if (production?.tag && this.policy.status) production.version = await this.policy.status(production.tag, this.repo);
      const main = `origin/${this.repo.branch}`;
      return { production, main: { version: this.policy.status ? await this.policy.status(main, this.repo) : null, sha: (await this.repo.git(['rev-parse', main])).trim() } };
    });
    return { production, main, policy: this.policy.label, ...this.urls };
  }
}
