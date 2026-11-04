---
id: RQ-0002
status: completed
executionMode: handoff
pipelineFast: false
createdByName: "Batur Orkun"
createdByEmail: "batur@bc.int"
createdAt: "2026-11-04T07:41:42.185Z"
branch: "factory/RQ-0002"
createdFromCommit: "229051bfb1eff32069d8dccd6454bcabda8d6f86"
completedRunId: "20261104084537-RQ-0002"
completedBy: "Batur Orkun"
completedAt: "2026-11-04T09:04:45.322Z"
githubPullRequestUrl: "https://github.com/baturorkun/site-content-bot/pull/4"
githubPullRequestIid: 4
githubIssueUrl: "https://github.com/baturorkun/site-content-bot/issues/3"
githubIssueIid: 3
repositoryProvider: github
---
# RQ-0002 - GitHub as a second platform: login, deploy state and releases

RQ-0001 moved the bot here with everything about the site in
`content-bot.config.mjs`, but the bot still speaks to one platform, GitLab:
the login is GitLab's OAuth and its project membership, the state of a commit
comes from GitLab pipelines, production is the latest GitLab Release, and
**Release…** makes one. A site on GitHub cannot run it.

This requirement adds GitHub as a second platform behind one interface, so
that a site on GitHub or GitHub Enterprise has the same bot: log in with
GitHub, the same access rules, **Recent changes** showing where a commit is in
GitHub Actions, production as the latest GitHub Release, **Release…** making
one. GitLab keeps working exactly as today. The bot itself (chat, edits, guard,
copies, push, undo, release flow) does not change; only the platform
behind it is chosen at start.

Two leftovers of the website also leave the code on the way, because the
GitHub side would otherwise have to copy them: the names of the deploy jobs
(`deploy_linux`, `deploy_release`) move into the config, and the GitLab names
of the settings become platform-neutral. Nothing has been published, so no
compatibility layer is kept beyond a clear message naming the new name.

## Taken along: the website's version fix (website 700b8bd, 4 Nov)

The website fixed its bot the same day: a push after a release, without a new
requirement, releases as the last number + 1 (`1.<N>.<run>` becomes the tag
at the commit when the requirement already has a release tag there, and the
newest such tag's last number + 1 past it); the clone fetches the tags for
that; "nothing to release" says that nothing has been pushed since
production's release. The package takes the same change in `version.ts`
(`requirementVersion`), `repo.ts` (`--tags`) and `bot.ts`, with its tests,
so the two do not drift before the website moves to the package.

## The platform interface

- `src/platform.ts` declares what the bot needs from a platform and nothing
  more, as `commands.ts` wires it today: the display name and host (for the
  page), the login (`start()`, `finish()` as `auth.ts` has them, returning the
  same `User`), `deployState({ sha | ref, job })`, `latestRelease()`,
  `lastGreenMain(job)`, `createRelease({ tag, ref, name, description })`,
  `projectReachable()` and `accessName(level)` (what the page calls a level).
- `src/gitlab.ts` becomes that interface for GitLab (`gitlabPlatform(settings)`),
  made of today's `GitLabAuth` and functions, behaviour unchanged; the
  functions stay exported for the tests and `index.ts`.
- `src/github.ts` is the same for GitHub (`githubPlatform(settings)`), on
  GitHub's REST API v3 with the bot's token (`Authorization: Bearer`,
  `X-GitHub-Api-Version` set); `<url>/api/v3` on GitHub Enterprise,
  `https://api.github.com` for github.com.
- `ContentBot`, `createApp` and the page take the platform (or what it
  provides), not GitLab's types; the texts "GitLab Release", "Log in with
  GitLab", "on GitLab" come from the platform's name. `bot.ts`'s prompt line
  about production says "there is no <platform> Release yet".
- Which platform: `CONTENT_BOT_PLATFORM` (`gitlab` | `github`); when it is
  empty, from the host of `CONTENT_BOT_REPO_URL`: `github.com` (or a host
  starting with `github.`) means `github`, anything else `gitlab`. `serve`
  logs the platform it chose; `check` reports it on its first line.

## GitHub

- **Login**: a GitHub OAuth App (`CONTENT_BOT_OAUTH_ID`/`SECRET`, callback
  `<CONTENT_BOT_URL>/auth/callback`): `/login/oauth/authorize` with scope
  `read:user user:email` and the same state cookie; `/login/oauth/access_token`
  (JSON); `/user` and `/user/emails` for the name, login and the primary
  verified e-mail (the commit author). A user without a verified e-mail is
  refused, named.
- **Access**: `GET /repos/<project>/collaborators/<login>/permission` with the
  bot's token; `role_name` maps onto the same numeric scale GitLab uses so
  `CONTENT_BOT_MIN_ACCESS` keeps its meaning: `read` → 20, `triage` → 20,
  `write` → 30, `maintain` → 40, `admin` → 50; `none`/404 → not a
  collaborator. Who may release stays "40 and above" (maintain, admin). The
  page names the levels GitHub's way (`write`, `maintain`), through
  `accessName`.
- **Deploy state**: the newest Actions run for the commit
  (`/actions/runs?head_sha=…`) or for the ref (`?branch=<tag>`, which is how
  GitHub lists a tag's runs), its jobs (`/actions/runs/<id>/jobs`), and the
  job named in the config: `failed` when the run or the job failed,
  `deployed` when the job succeeded, `running` otherwise, `waiting` with no
  run, `unknown` without settings; `pipeline` is the run's `html_url`.
- **Latest release**: `/releases/latest` (GitHub's: not a draft, not a
  pre-release), the tag resolved to its commit with `/commits/<tag>`; null
  with none (404).
- **Last green main**: the newest successful run on `main`
  (`/actions/runs?branch=main&status=success`) whose jobs include the test
  deploy job of the config, so a green lint workflow on a commit whose deploy
  failed does not count; `{ sha, pipeline }` or null.
- **Release**: `POST /releases` with `tag_name`, `target_commitish` (the sha
  the user saw), `name`, `body`; GitHub's `message` comes back on a refusal
  (a ruleset protecting `v*` tags refuses a token that is not allowed to
  bypass it; the README says so).
- **Project reachable**: `GET /repos/<project>` answers the token; its
  `full_name` is reported.

## The config: `deploy`

- A new optional field `deploy: { test: '<job>', production: '<job>' }`: the
  names of the jobs that put main on the test domain and a release tag on
  production, in the site's pipeline (GitLab job names, GitHub Actions job
  names). Default `{ test: 'deploy_linux', production: 'deploy_release' }`,
  today's values, so the website's config needs no change. `validateConfig`
  checks both are non-empty strings; unknown fields in it are rejected as
  elsewhere.
- The `init` example and the README's config section show it.

## Settings

- Renamed, platform-neutral: `CONTENT_BOT_GITLAB_TOKEN` → `CONTENT_BOT_TOKEN`,
  `GITLAB_URL` → `CONTENT_BOT_PLATFORM_URL`, `CONTENT_BOT_GITLAB_PROJECT` →
  `CONTENT_BOT_PROJECT`. New: `CONTENT_BOT_PLATFORM` (optional, above).
- `CONTENT_BOT_PLATFORM_URL` is required for GitLab (the instance) and
  optional for GitHub (default `https://github.com`; set it for GitHub
  Enterprise). `CONTENT_BOT_PROJECT` is `group/site` on GitLab,
  `owner/repo` on GitHub.
- An old name still set makes `serve` refuse to start and `check` report
  FAIL, naming the new name, as the removed variables do today (`RENAMED`
  beside `REMOVED` in `commands.ts`). The askpass script reads the token
  under its new name.
- The README's settings table, `assets/init/env.example` and the Dockerfile
  comments use the new names; the README gains a section "On GitHub": the
  OAuth App (Settings > Developer settings > OAuth Apps, the callback URL),
  the token (a fine-grained token with Contents read/write, Actions read,
  Metadata read on the repository, or a classic token with `repo`), the
  collaborator roles and what they allow, the ruleset note for `v*` tags.

## Tests

- `tests/bot.test.mjs` keeps its fake GitLab and its bot scenarios, which
  are platform-free (the bot gets the platform's functions handed in); one
  scenario runs the bot as on GitHub and checks that the prompt and the
  refusals say GitHub and its roles.
- `tests/github.test.mjs`, against a fake GitHub (`fetch` answering the
  endpoints above): the login (the OAuth App URL, the primary verified
  e-mail, each role's access, triage and strangers refused, Enterprise under
  `/api/v3`), deploy state for each outcome (no run, running, job failed,
  run failed, deployed, a tag by its branch), latest release with and without
  one, last green main skipping a run without the deploy job, a release made
  and one refused with GitHub's message, the repository answering the token;
  and the server wired to the GitHub platform: the page and `/api/me` say
  GitHub, the login goes to GitHub and a writer comes in.
- `tests/cli.test.mjs`: platform choice from `CONTENT_BOT_PLATFORM` and from
  the repository host; a renamed variable refused with its new name; `check`
  reporting the platform.
- `tests/config.test.mjs`: `deploy` default, validation, unknown field.

## Acceptance Criteria

- `src/platform.ts` declares the interface; `gitlabPlatform` and
  `githubPlatform` implement it; `commands.ts` picks one from
  `CONTENT_BOT_PLATFORM` or the repository host and wires nothing
  platform-specific itself.
- With a fake GitHub, a user logs in, their role decides their access (write
  edits, maintain releases, triage is refused), the deploy state is
  waiting/running/failed/deployed from Actions runs and the deploy job,
  production is the latest GitHub Release, a Release is created at the commit
  given, and the bot's refusals, the page and the API texts say GitHub.
- With the fake GitLab, every RQ-0001 test passes unchanged in behaviour (the
  renamed variables and the `deploy` field aside).
- The deploy job names come from `config.deploy`, default to today's names,
  and are validated.
- The old variable names are refused by `serve` and reported by `check`, each
  with its new name; the new names work for both platforms;
  `CONTENT_BOT_PLATFORM_URL` defaults for GitHub only.
- `check` reports the platform and its project API; `init` writes `deploy`
  and the neutral variable names; the README documents GitHub setup, the role
  mapping and the renamed variables.
- `grep -rn -i "bytecraft\|bc\.int\|192\.168\." src assets tests README.md`
  finds the README example only.
- `requirementVersion` gives the tag's version at a tagged commit and the
  newest tag's last number + 1 past it; the clone's sync and fetch bring the
  tags; "nothing to release" names production's tag and that nothing was
  pushed since.
- `package.json` version `0.2.0`; `pnpm typecheck`, `pnpm test`,
  `pnpm pack:check` and `pnpm template:check` pass.
