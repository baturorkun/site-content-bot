// What Release… offers as the next version, fixed, not chosen (RQ-0001): a
// policy named in the config, or the site's own function.
//
//   aifactory  1.<N>.<run>: N the highest completed requirement under
//              requirements/ at the candidate commit, run the largest retries
//              in that requirement's completedRunId manifest (the attempt
//              counter); 1.0.0 with none. The version the site's footer shows.
//   patch      production's tag with the patch number raised; 1.0.0 with no
//              release.
//   function   ({ candidate, production, read }) => 'MAJOR.MINOR.PATCH'.
import type { Config, VersionFunction, VersionInput } from './config.js';

export const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;
const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;

export interface RequirementVersion { version: string; requirement: string; run: number }

// What the policies read: a commit's files, and git for the aifactory rule.
export interface StatusRepo {
  git: (args: string[]) => Promise<string>;
  show: (ref: string, path: string) => Promise<string | undefined>;
}

export interface NextInput { candidate: string; production: VersionInput['production']; repo: StatusRepo }

export interface VersionPolicy {
  // The rule in a few words, for the page and the refusals.
  label: string;
  // What comes after "No changes to release: production already runs vX."
  unchangedHint: string;
  // The next version, MAJOR.MINOR.PATCH without the v.
  next: (input: NextInput) => Promise<string>;
  // What the sidebar shows beside a commit, when the policy has such a thing.
  status?: (ref: string, repo: StatusRepo) => Promise<RequirementVersion | null>;
}

// The version a commit is at under the aifactory rule (moved here from the
// website's repo.mjs rqVersion). Null with no completed requirement.
export const requirementVersion = async (ref: string, repo: StatusRepo): Promise<RequirementVersion | null> => {
  let files = '';
  try { files = await repo.git(['grep', '-l', '^status: completed', ref, '--', 'requirements/']); } catch { files = ''; }
  const found = [...files.matchAll(/^[^:\n]+:(requirements\/RQ-(\d+)[^\n]*)$/gm)].map((match) => ({ path: match[1]!, n: Number(match[2]) }));
  if (!found.length) return null;
  const last = found.reduce((a, b) => (b.n > a.n ? b : a));
  const runDir = ((await repo.show(ref, last.path)) ?? '').match(/^completedRunId: *"?([\w-]+)"?\s*$/m)?.[1];
  let run = 0;
  try {
    const manifest = JSON.parse((runDir && await repo.show(ref, `runs/${runDir}/manifest.json`)) || '{}');
    run = Math.max(0, ...(manifest.steps ?? []).map((step: { retries?: unknown }) => Number(step.retries) || 0));
  } catch { run = 0; }
  return { version: `1.${last.n}.${run}`, requirement: `RQ-${String(last.n).padStart(4, '0')}`, run };
};

const aifactory: VersionPolicy = {
  label: '1.<last requirement>.<its run id>',
  unchangedHint: 'A new version comes with the next completed requirement.',
  next: async ({ candidate, repo }) => (await requirementVersion(candidate, repo))?.version ?? '1.0.0',
  status: requirementVersion,
};

const patch: VersionPolicy = {
  label: "production's version with the patch number raised",
  unchangedHint: 'Every change on main makes a new version.',
  next: async ({ production }) => {
    const parts = production?.tag.match(VERSION)?.slice(1).map(Number);
    if (!parts) return '1.0.0';
    return `${parts[0]}.${parts[1]}.${parts[2]! + 1}`;
  },
};

const custom = (fn: VersionFunction): VersionPolicy => ({
  label: "the site's own rule (content-bot.config.mjs version)",
  unchangedHint: "The version comes from the site's own rule.",
  next: async ({ candidate, production, repo }) => {
    const value = await fn({ candidate, production, read: (path) => repo.show(candidate, path) });
    if (typeof value !== 'string' || !PLAIN.test(value)) throw new Error(`the site's version rule returned ${JSON.stringify(value)}, not MAJOR.MINOR.PATCH`);
    return value;
  },
});

export const versionPolicies = { aifactory, patch } as const;

export const versionPolicy = (version: Config['version']): VersionPolicy => {
  if (typeof version === 'function') return custom(version);
  return versionPolicies[version];
};

// The next version for the candidate commit under a policy, with the v.
export const nextVersion = async (policy: VersionPolicy, input: NextInput): Promise<string> => `v${await policy.next(input)}`;
