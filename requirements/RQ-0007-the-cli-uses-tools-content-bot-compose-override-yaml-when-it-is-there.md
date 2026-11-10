---
id: RQ-0007
status: completed
executionMode: handoff
pipelineFast: false
createdByName: "Batur Orkun"
createdByEmail: "batur@bc.int"
createdAt: "2026-11-10T10:43:02.125Z"
branch: "factory/RQ-0007"
createdFromCommit: "235c3a0d46f28cb0c698051981d4f8226ed1b62b"
completedRunId: "20261110104524-RQ-0007"
completedBy: "human"
completedAt: "2026-11-10T10:56:44.331Z"
githubPullRequestUrl: "https://github.com/baturorkun/site-content-bot/pull/14"
githubPullRequestIid: 14
githubIssueUrl: "https://github.com/baturorkun/site-content-bot/issues/13"
githubIssueIid: 13
repositoryProvider: github
---
# RQ-0007 - The CLI uses tools/content-bot/compose.override.yaml when it is there

The CLI runs compose with `-f compose.yaml` alone, in `tools/content-bot/`.
A host that needs a setting of its own for the container has nowhere to put
it: compose reads `compose.override.yaml` only when no `-f` is given. On the
Bytecraft lab host the website's bot needs one (`extra_hosts` for its
GitLab's name, which containers there do not resolve), so started by the CLI
it cannot reach its repository; today it is started with `docker compose` by
hand instead.

## Decisions (Batur, 10 November 2026)

- The CLI uses `tools/content-bot/compose.override.yaml` when it is there.
- The release is 0.6.0, so npmjs and the image carry the same version; the
  website takes it as a devDependency (website RQ-0027).

## What it does

- Every compose call of the CLI (`start`, `stop`, `logs`, `status`, `update`,
  `login`) passes `-f compose.yaml -f compose.override.yaml` when
  `tools/content-bot/compose.override.yaml` exists, `-f compose.yaml` alone
  when it does not (as today).
- `init` keeps `tools/content-bot/compose.override.yaml` out of git, as it
  does `.env`.
- README: what the override is for (settings of this host only, never
  committed), with the `extra_hosts` example.
- Version 0.6.0 in `package.json`.

## Out of scope

- The bot itself, the image's contents, the config.

## Acceptance Criteria

- With `tools/content-bot/compose.override.yaml` present, the CLI's compose
  calls name both files; without it, `compose.yaml` alone; tests show both.
- `init` adds `tools/content-bot/compose.override.yaml` to `.gitignore`
  (once), next to `.env`; a test shows it.
- README describes the override.
- `package.json` is at 0.6.0.
- The quality gates pass.
