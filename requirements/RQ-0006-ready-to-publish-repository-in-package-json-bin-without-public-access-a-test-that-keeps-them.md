---
id: RQ-0006
status: completed
executionMode: handoff
pipelineFast: false
createdByName: "Batur Orkun"
createdByEmail: "batur@bc.int"
createdAt: "2026-11-04T11:52:05.219Z"
branch: "factory/RQ-0006"
createdFromCommit: "527ae835eee7fe58312c3f0b2c2496958ffb47a2"
completedRunId: "20261104115236-RQ-0006"
completedBy: "Batur Orkun"
completedAt: "2026-11-04T11:58:10.501Z"
githubPullRequestUrl: "https://github.com/baturorkun/site-content-bot/pull/12"
githubPullRequestIid: 12
githubIssueUrl: "https://github.com/baturorkun/site-content-bot/issues/11"
githubIssueIid: 11
repositoryProvider: github
---
# RQ-0006 - ready to publish: repository in package.json, bin without ./, public access, a test that keeps them

The first `v0.5.0` tag would not give a working package, for the reasons
agents-diet met on its first release:

- `package.json` has no `repository`; `publish.yml` checks that it names this
  repository (npm provenance refuses otherwise) and stops before publishing.
- `bin` is `./dist/cli.js`; npm 11 drops a bin whose path starts with `./`
  from the registry manifest ("script name … was invalid and removed"), so
  `npx site-content-bot init` would find no command. `pnpm pack:check`
  installs the local tarball and does not see it.
- No `publishConfig.access`: `publish.yml` passes `--access public`, a local
  publish would not.

## The change

- `package.json`: `repository` `{ "type": "git", "url":
  "git+https://github.com/baturorkun/site-content-bot.git" }`, `homepage`
  and `bugs` of that repository, `bin` `{ "site-content-bot": "dist/cli.js" }`,
  `publishConfig` `{ "access": "public" }`, `keywords`. The version stays
  `0.5.0` (nothing has been published).
- `tests/package.test.mjs`: each bin path is relative without `./` or `/`
  and is built; `repository.url` names `github.com/baturorkun/site-content-bot`
  (as `publish.yml` checks it); `publishConfig.access` is `public`;
  `files` holds `dist` and `assets` and not `docker`, `src`, `tests`.
- README: *Publishing* (for the maintainer): the `NPM_TOKEN` secret, the tag,
  the staged first publish (npmjs.com, Staged Packages, Approve), the GHCR
  package's visibility.

## Acceptance Criteria

- `package.json` as above; `node -p "require('./package.json').bin"` gives
  `dist/cli.js`.
- `tests/package.test.mjs` passes and fails on a `./` bin or a missing
  repository.
- `pnpm typecheck`, `pnpm test`, `pnpm pack:check`, `pnpm template:check`
  pass.
