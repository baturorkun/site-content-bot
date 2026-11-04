// GitHub as the platform: the login through a GitHub OAuth App and the
// person's role on the repository, where a commit is in GitHub Actions, the
// latest GitHub Release, the newest green main run, and making a Release. The
// REST API v3 with the bot's token: api.github.com for github.com, <url>/api/v3
// on GitHub Enterprise.
import { randomBytes } from 'node:crypto';
import type { User } from './auth.js';
import type { Auth, DeployState, Platform, PlatformSettings, Release } from './platform.js';

const STATE_TTL_MS = 10 * 60_000;
const API_VERSION = '2022-11-28';

// A collaborator's role on the bot's scale, so CONTENT_BOT_MIN_ACCESS means
// the same on both platforms: write is a Developer (30), maintain a
// Maintainer (40), admin an Owner (50); read and triage cannot push.
export const ROLE_LEVEL: Record<string, number> = { read: 20, triage: 20, write: 30, maintain: 40, admin: 50 };
export const GITHUB_ACCESS: Record<number, string> = { 20: 'read', 30: 'write', 40: 'maintain', 50: 'admin' };

export const githubAccessName = (level: number): string => GITHUB_ACCESS[level] ?? Object.entries(GITHUB_ACCESS).filter(([at]) => Number(at) >= level).map(([, name]) => name)[0] ?? `level ${level}`;

// github.com's API lives on its own host; an Enterprise server's under /api/v3.
export const apiBase = (url: string): string => {
  const base = url.replace(/\/$/, '');
  return /^https?:\/\/(www\.)?github\.com$/i.test(base) ? 'https://api.github.com' : `${base}/api/v3`;
};

const headers = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': API_VERSION,
  'User-Agent': 'site-content-bot',
  ...extra,
});

const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return ''; } };

const failed = (conclusion: string | null | undefined): boolean => ['failure', 'cancelled', 'timed_out', 'startup_failure'].includes(conclusion ?? '');

class GitHubAuth implements Auth {
  url: string;
  api: string;
  clientId: string;
  secret: string;
  redirectUri: string;
  project: string;
  token: string;
  minAccess: number;
  fetch: typeof fetch;
  states: Map<string, number>;

  constructor({ url, clientId, secret, redirectUri, project, token, minAccess = 30, fetchImpl = fetch }: PlatformSettings) {
    this.url = url.replace(/\/$/, '');
    this.api = apiBase(url);
    this.clientId = clientId;
    this.secret = secret;
    this.redirectUri = redirectUri;
    this.project = project;
    this.token = token;
    this.minAccess = minAccess;
    this.fetch = fetchImpl;
    this.states = new Map();
  }

  start(): { state: string; location: string } {
    const now = Date.now();
    for (const [state, at] of this.states) if (now - at > STATE_TTL_MS) this.states.delete(state);
    const state = randomBytes(24).toString('hex');
    this.states.set(state, now);
    const query = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri, state, scope: 'read:user user:email' });
    return { state, location: `${this.url}/login/oauth/authorize?${query}` };
  }

  async json(url: string, init: RequestInit | undefined, what: string): Promise<any> {
    const response = await this.fetch(url, init);
    if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status} for ${what}`), { status: response.status });
    return response.json();
  }

  // The person behind a callback: { name, email, username, accessLevel }; the
  // e-mail is their primary verified one (the author of the commits they ask for).
  async finish({ code, state, cookieState }: { code: string | null; state: string | null; cookieState: string | undefined }): Promise<User> {
    const issued = state === null ? undefined : this.states.get(state);
    if (state !== null) this.states.delete(state);
    if (!code || !state || state !== cookieState || !issued || Date.now() - issued > STATE_TTL_MS) throw new Error('The login took too long or did not start here; try again.');
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, code, redirect_uri: this.redirectUri });
    const granted = await this.json(`${this.url}/login/oauth/access_token`, { method: 'POST', body, headers: { Accept: 'application/json' } }, 'the login');
    if (!granted.access_token) throw new Error(`GitHub refused the login${granted.error_description ? `: ${granted.error_description}` : ''}.`);
    const own = headers(granted.access_token);
    const user = await this.json(`${this.api}/user`, { headers: own }, 'the user');
    let email: string | undefined = undefined;
    try {
      const emails: { email: string; primary: boolean; verified: boolean }[] = await this.json(`${this.api}/user/emails`, { headers: own }, 'the e-mail');
      email = (emails.find((entry) => entry.primary && entry.verified) ?? emails.find((entry) => entry.verified))?.email;
    } catch { email = undefined; }
    if (!email) throw new Error(`The GitHub account ${user.login ?? ''} has no verified e-mail.`);
    let role = 'none';
    try {
      const permission = await this.json(`${this.api}/repos/${this.project}/collaborators/${encodeURIComponent(user.login)}/permission`, { headers: headers(this.token) }, 'the collaborator');
      role = permission.role_name ?? permission.permission ?? 'none';
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const accessLevel = ROLE_LEVEL[role] ?? 0;
    if (accessLevel < this.minAccess) {
      throw new Error(`${user.name || user.login} does not have the ${githubAccessName(this.minAccess)} role (or above) on ${this.project} on GitHub; ask an admin of the repository.`);
    }
    return { name: user.name || user.login, email, username: user.login, accessLevel };
  }
}

export const githubPlatform = (settings: PlatformSettings): Platform => {
  const { url, project, token, fetchImpl = fetch } = settings;
  const api = `${apiBase(url)}/repos/${project}`;
  const get = async (path: string, what: string): Promise<any> => {
    const response = await fetchImpl(`${api}${path}`, { headers: headers(token) });
    if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status} for ${what}`), { status: response.status });
    return response.json();
  };
  // The jobs of a run, and whether one of them is the deploy job named.
  const jobOf = async (runId: number, job: string): Promise<{ conclusion?: string | null; status?: string } | undefined> => {
    const { jobs = [] } = await get(`/actions/runs/${runId}/jobs?per_page=100`, 'the jobs');
    return jobs.find((entry: { name: string }) => entry.name === job);
  };

  return {
    name: 'GitHub',
    host: hostOf(url),
    project,
    auth: new GitHubAuth(settings),
    accessName: githubAccessName,
    releaseRole: 'a collaborator with the maintain or admin role',

    async deployState({ sha, ref = 'main', job }) {
      if (!url || !project || !token) return { state: 'unknown' };
      const query = sha ? `head_sha=${sha}` : `branch=${encodeURIComponent(ref)}`;
      const { workflow_runs: runs = [] } = await get(`/actions/runs?${query}&per_page=1`, 'the runs');
      const [run] = runs;
      if (!run) return { state: 'waiting' };
      const deploy = await jobOf(run.id, job);
      if (failed(run.conclusion) || failed(deploy?.conclusion)) return { state: 'failed', pipeline: run.html_url };
      if (deploy?.conclusion === 'success') return { state: 'deployed', pipeline: run.html_url };
      return { state: 'running', pipeline: run.html_url };
    },

    async latestRelease(): Promise<Release | null> {
      if (!url || !project || !token) throw new Error('GitHub is not configured (CONTENT_BOT_PLATFORM_URL, the token)');
      let release: any;
      try {
        release = await get('/releases/latest', 'the releases');
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
      const commit = await get(`/commits/${encodeURIComponent(release.tag_name)}`, `the commit of ${release.tag_name}`);
      return { tag: release.tag_name, commit: commit.sha ?? '' };
    },

    // The newest successful run on main whose jobs include the deploy job, so
    // a green lint workflow on a commit whose deploy failed does not count.
    async lastGreenMain(job) {
      if (!url || !project || !token) throw new Error('GitHub is not configured (CONTENT_BOT_PLATFORM_URL, the token)');
      const { workflow_runs: runs = [] } = await get('/actions/runs?branch=main&status=success&per_page=10', 'the runs');
      for (const run of runs) {
        if (await jobOf(run.id, job)) return { sha: run.head_sha, pipeline: run.html_url };
      }
      return null;
    },

    async createRelease({ tag, ref, name, description }) {
      const response = await fetchImpl(`${api}/releases`, {
        method: 'POST',
        headers: headers(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tag_name: tag, target_commitish: ref, name, body: description }),
      });
      const body: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        const said = [body.message, ...(body.errors ?? []).map((error: any) => (typeof error === 'string' ? error : error.message ?? JSON.stringify(error)))].filter(Boolean).join('; ');
        throw new Error(`GitHub refused the release (${response.status})${said ? `: ${said}` : ''}`);
      }
      return { tag: body.tag_name, url: body.html_url ?? '' };
    },

    async projectReachable() {
      const body = await get('', `the repository ${project}`);
      return body.full_name ?? project;
    },
  };
};
