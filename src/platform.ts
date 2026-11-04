// What the bot needs from the platform that hosts the site's repository, and
// nothing more (RQ-0002): who the person logging in is and what they may do,
// where a commit is on its way (the pipeline or workflow run and its deploy
// job), the latest Release (what production serves), the newest green main
// commit (what a release ships), and making a Release. gitlab.ts and github.ts
// are the two platforms; commands.ts picks one from the settings.
import type { User } from './auth.js';
import { gitlabPlatform } from './gitlab.js';
import { githubPlatform } from './github.js';

export type DeployState = { state: 'unknown' | 'waiting' | 'failed' | 'deployed' | 'running'; pipeline?: string };

export interface Release { tag: string; commit: string }

// The login: where the browser goes, and who came back.
export interface Auth {
  start(): { state: string; location: string };
  finish(input: { code: string | null; state: string | null; cookieState: string | undefined }): Promise<User>;
}

export interface Platform {
  // 'GitLab' or 'GitHub', as the page and the messages say it.
  name: string;
  // The host the person logs in at, for the page.
  host: string;
  project: string;
  auth: Auth;
  // What the platform calls an access level of the bot's scale (30: Developer
  // on GitLab, write on GitHub).
  accessName(level: number): string;
  // Who may release, for the refusals: "a Maintainer or Owner of the project".
  releaseRole: string;
  // Where a pushed commit (sha) or a ref (a release tag) is on its way, by the
  // deploy job named: failed, deployed, running, waiting with no run, unknown
  // without settings.
  deployState(input: { sha?: string; ref?: string; job: string }): Promise<DeployState>;
  // The latest Release, what production serves; null with none.
  latestRelease(): Promise<Release | null>;
  // The newest main commit whose pipeline passed with the deploy job named.
  lastGreenMain(job: string): Promise<{ sha: string; pipeline: string } | null>;
  createRelease(input: { tag: string; ref: string; name: string; description: string }): Promise<{ tag: string; url: string }>;
  // Whether the project answers the token: its path, or the reason it does not.
  projectReachable(): Promise<string>;
}

export const PLATFORM_NAMES = ['gitlab', 'github'] as const;
export type PlatformName = (typeof PLATFORM_NAMES)[number];

export interface PlatformSettings {
  // The platform's address: the GitLab instance; github.com or a GitHub
  // Enterprise host.
  url: string;
  project: string;
  token: string;
  // The OAuth application and this bot's /auth/callback.
  clientId: string;
  secret: string;
  redirectUri: string;
  minAccess?: number;
  fetchImpl?: typeof fetch;
}

// Which platform: the name given (CONTENT_BOT_PLATFORM), else from the host of
// the repository's URL: github.com, or a host starting with github., means
// GitHub; anything else GitLab. A name that is neither is refused.
export const platformOf = (name: string | undefined, repoUrl: string): { platform: PlatformName; from: string } => {
  if (name) {
    if (!PLATFORM_NAMES.includes(name as PlatformName)) throw new Error(`CONTENT_BOT_PLATFORM is ${JSON.stringify(name)}; it is one of ${PLATFORM_NAMES.join(', ')}`);
    return { platform: name as PlatformName, from: 'CONTENT_BOT_PLATFORM' };
  }
  let host = '';
  try { host = new URL(repoUrl).host.toLowerCase(); } catch { host = ''; }
  const github = host === 'github.com' || host.startsWith('github.');
  return { platform: github ? 'github' : 'gitlab', from: `the repository host ${host || '(none)'}` };
};

export const createPlatform = (name: PlatformName, settings: PlatformSettings): Platform => (name === 'github' ? githubPlatform(settings) : gitlabPlatform(settings));
