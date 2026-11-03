// GitLab's API for the bot: where a commit is on its way (the pipeline and its
// deploy job), the latest Release (what production serves), the newest green
// main commit (what a release ships) and making a Release.

export interface GitLabSettings { url: string; project: string; token: string; fetchImpl?: typeof fetch }

export type DeployState = { state: 'unknown' | 'waiting' | 'failed' | 'deployed' | 'running'; pipeline?: string };

const projectApi = (url: string, project: string): string => `${url.replace(/\/$/, '')}/api/v4/projects/${encodeURIComponent(project)}`;

const getter = ({ url, project, token, fetchImpl = fetch }: GitLabSettings) => async (path: string): Promise<any> => {
  const response = await fetchImpl(`${projectApi(url, project)}${path}`, { headers: { 'PRIVATE-TOKEN': token } });
  if (!response.ok) throw new Error(`GitLab answered ${response.status}`);
  return response.json();
};

// Where a pushed commit is on its way: the newest pipeline of the ref (for a
// commit, of that commit) and its deploy job: deploy_linux on main (the test
// domain), deploy_release on a release tag (production).
export const deployState = async ({ url, project, token, sha, ref = 'main', job: jobName = 'deploy_linux', fetchImpl = fetch }: GitLabSettings & { sha?: string; ref?: string; job?: string }): Promise<DeployState> => {
  if (!url || !project || !token) return { state: 'unknown' };
  const get = getter({ url, project, token, fetchImpl });
  const [pipeline] = await get(`/pipelines?${sha ? `sha=${sha}&` : ''}ref=${encodeURIComponent(ref)}&per_page=1`);
  if (!pipeline) return { state: 'waiting' };
  const jobs = await get(`/pipelines/${pipeline.id}/jobs?per_page=100`);
  const deploy = jobs.find((job: { name: string }) => job.name === jobName);
  if (pipeline.status === 'failed' || deploy?.status === 'failed') return { state: 'failed', pipeline: pipeline.web_url };
  if (deploy?.status === 'success') return { state: 'deployed', pipeline: pipeline.web_url };
  return { state: 'running', pipeline: pipeline.web_url };
};

export interface Release { tag: string; commit: string }

// The latest GitLab Release, what production serves: { tag, commit }, or null
// when the project has none. Unset settings or an unreachable GitLab throw, named.
export const latestRelease = async ({ url, project, token, fetchImpl = fetch }: GitLabSettings): Promise<Release | null> => {
  if (!url || !project || !token) throw new Error('GitLab is not configured (GITLAB_URL, the token)');
  const response = await fetchImpl(`${projectApi(url, project)}/releases?order_by=released_at&sort=desc&per_page=1`, { headers: { 'PRIVATE-TOKEN': token } });
  if (!response.ok) throw new Error(`GitLab answered ${response.status} for the releases`);
  const [release] = (await response.json()) as any[];
  if (!release) return null;
  return { tag: release.tag_name, commit: release.commit?.id ?? '' };
};

// The newest main commit whose pipeline passed, so the test domain serves it:
// what a release from the bot ships. { sha, pipeline } or null.
export const lastGreenMain = async ({ url, project, token, fetchImpl = fetch }: GitLabSettings): Promise<{ sha: string; pipeline: string } | null> => {
  if (!url || !project || !token) throw new Error('GitLab is not configured (GITLAB_URL, the token)');
  const [pipeline] = await getter({ url, project, token, fetchImpl })('/pipelines?ref=main&status=success&per_page=1');
  return pipeline ? { sha: pipeline.sha, pipeline: pipeline.web_url } : null;
};

// A GitLab Release and its tag at ref, made with the bot's token (it needs the
// api scope). GitLab's own message comes back on a refusal.
export const createRelease = async ({ url, project, token, tag, ref, name, description, fetchImpl = fetch }: GitLabSettings & { tag: string; ref: string; name: string; description: string }): Promise<{ tag: string; url: string }> => {
  const response = await fetchImpl(`${projectApi(url, project)}/releases`, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, ref, name, description }),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const said = body.message ?? body.error ?? '';
    throw new Error(`GitLab refused the release (${response.status})${said ? `: ${typeof said === 'string' ? said : JSON.stringify(said)}` : ''}`);
  }
  return { tag: body.tag_name, url: body._links?.self ?? '' };
};

// Whether the project answers the token: its API path, or the reason it does not.
export const projectReachable = async ({ url, project, token, fetchImpl = fetch }: GitLabSettings): Promise<string> => {
  const response = await fetchImpl(projectApi(url, project), { headers: { 'PRIVATE-TOKEN': token } });
  if (!response.ok) throw new Error(`GitLab answered ${response.status} for the project ${project}`);
  const body: any = await response.json();
  return body.path_with_namespace ?? project;
};
