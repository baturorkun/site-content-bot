// The login: GitLab's own, through OAuth, so it is the company's login and the
// bot keeps no passwords. GitLab says who the person is (name, e-mail: the
// author of the commits they ask for); the bot lets them in when they are a
// member of the site's project with at least the access level asked (Developer
// by default), read with the bot's own token. Their level also decides who may
// release (Maintainer and above, as GitLab's protected v* tags do).
import { randomBytes } from 'node:crypto';

const STATE_TTL_MS = 10 * 60_000;
export const ACCESS: Record<number, string> = { 10: 'Guest', 15: 'Planner', 20: 'Reporter', 30: 'Developer', 40: 'Maintainer', 50: 'Owner' };

export interface User { name: string; email: string; username: string; accessLevel: number }

export interface GitLabAuthOptions {
  url: string;
  clientId: string;
  secret: string;
  redirectUri: string;
  project: string;
  token: string;
  minAccess?: number;
  fetchImpl?: typeof fetch;
}

export class GitLabAuth {
  url: string;
  clientId: string;
  secret: string;
  redirectUri: string;
  project: string;
  token: string;
  minAccess: number;
  fetch: typeof fetch;
  states: Map<string, number>;

  // url: GitLab; clientId, secret: the OAuth application; redirectUri: this
  // bot's /auth/callback as the browser reaches it; project, token: the site's
  // project and the bot's token, for the membership; minAccess: 30.
  constructor({ url, clientId, secret, redirectUri, project, token, minAccess = 30, fetchImpl = fetch }: GitLabAuthOptions) {
    this.url = url.replace(/\/$/, '');
    this.clientId = clientId;
    this.secret = secret;
    this.redirectUri = redirectUri;
    this.project = project;
    this.token = token;
    this.minAccess = minAccess;
    this.fetch = fetchImpl;
    this.states = new Map();
  }

  // Where the browser goes to log in, and the state it must bring back.
  start(): { state: string; location: string } {
    const now = Date.now();
    for (const [state, at] of this.states) if (now - at > STATE_TTL_MS) this.states.delete(state);
    const state = randomBytes(24).toString('hex');
    this.states.set(state, now);
    const query = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri, response_type: 'code', state, scope: 'read_user' });
    return { state, location: `${this.url}/oauth/authorize?${query}` };
  }

  async json(path: string, init: RequestInit | undefined, what: string): Promise<any> {
    const response = await this.fetch(`${this.url}${path}`, init);
    if (!response.ok) throw Object.assign(new Error(`GitLab answered ${response.status} for ${what}`), { status: response.status });
    return response.json();
  }

  // The person behind a callback: { name, email, username, accessLevel };
  // throws, named, when the state is not one this bot gave out or they may
  // not come in.
  async finish({ code, state, cookieState }: { code: string | null; state: string | null; cookieState: string | undefined }): Promise<User> {
    const issued = state === null ? undefined : this.states.get(state);
    if (state !== null) this.states.delete(state);
    if (!code || !state || state !== cookieState || !issued || Date.now() - issued > STATE_TTL_MS) throw new Error('The login took too long or did not start here; try again.');
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.secret, code, grant_type: 'authorization_code', redirect_uri: this.redirectUri });
    const { access_token: accessToken } = await this.json('/oauth/token', { method: 'POST', body }, 'the login');
    const user = await this.json('/api/v4/user', { headers: { Authorization: `Bearer ${accessToken}` } }, 'the user');
    const email = user.commit_email || user.email;
    if (user.state !== 'active' || !email) throw new Error(`The GitLab account ${user.username ?? ''} is not active or has no e-mail.`);
    let member: any;
    try {
      member = await this.json(`/api/v4/projects/${encodeURIComponent(this.project)}/members/all/${user.id}`, { headers: { 'PRIVATE-TOKEN': this.token } }, 'the membership');
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (!member || member.access_level < this.minAccess) {
      throw new Error(`${user.name} is not a ${ACCESS[this.minAccess] ?? `level ${this.minAccess}`} (or above) of ${this.project} on GitLab; ask a maintainer of the project.`);
    }
    return { name: user.name, email, username: user.username, accessLevel: member.access_level };
  }
}
