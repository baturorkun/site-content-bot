---
id: RQ-0003
status: ready
executionMode: handoff
pipelineFast: false
createdByName: "Batur Orkun"
createdByEmail: "batur@bc.int"
createdAt: "2026-11-04T09:05:39.283Z"
branch: "factory/RQ-0003"
createdFromCommit: "01eca4286e473fdfacf810355285500a9e77ed50"
githubPullRequestUrl: "https://github.com/baturorkun/site-content-bot/pull/6"
githubPullRequestIid: 6
githubIssueUrl: "https://github.com/baturorkun/site-content-bot/issues/5"
githubIssueIid: 5
repositoryProvider: github
---
# RQ-0003 - init as a wizard: platform and container engine detected, the config proposed from the repository, the token verified, .env written

Setting the bot up for a site is a dozen manual steps today (README, *Setting
it up for a site*): `init` writes four files with example values, then a
person edits the config by hand, creates the OAuth application and the token
on the platform, copies `.env.example` to `.env` and fills it, and only finds
out at `serve` whether a value was wrong. The platform (GitLab or GitHub)
decides half of those steps, and nothing tells the person which.

This requirement makes `init` a wizard. Run in a clone of the site's
repository on the host that will run the bot, it finds out what it can from
the repository and the machine, asks about the rest with a proposal to accept
with Enter, verifies the token live, and writes everything the bot needs:
`content-bot.config.mjs` (to commit), `tools/content-bot/{Dockerfile,
compose.yaml}` (to commit) and `tools/content-bot/.env` (never committed).
It ends with what it wrote and what comes next. The only step a person still
does on a platform page is creating the OAuth application, which has no API
(none on GitHub, admin-only on GitLab); the wizard gives the exact page and
the values to enter. Starting the container is RQ-0004 (`start`).

## The wizard

`site-content-bot init [--dir <path>] [--yes] [--<setting> <value>…]`, in
this order; each question shows its proposal and takes Enter for it; the
answers so far are kept when a later step fails.

1. **The repository**: `git remote get-url origin` in `--dir` (default `.`).
   An SSH remote (`git@host:owner/repo.git`, `ssh://git@host/…`) becomes its
   `https://host/owner/repo.git`; the project path is `owner/repo` without
   `.git`. Both are proposed as `CONTENT_BOT_REPO_URL` and
   `CONTENT_BOT_PROJECT`. With no remote, both are asked.
2. **The platform**: asked as the first question, since the rest depends on
   it, with a proposal and where it comes from ("GitLab, from the remote's
   host gitlab.com"). The proposal: by the host's name (`github.com`,
   `github.*` → GitHub; `gitlab.com`, `gitlab.*` → GitLab); a host whose name
   says neither (a company's own server) is asked without a token,
   `GET https://<host>/api/v3/meta` (GitHub Enterprise answers with its
   `installed_version`), then `GET https://<host>/api/v4/version` (GitLab
   answers 401 with `X-Gitlab-Meta` or "401 Unauthorized"), 5 s each; no
   answer and no remote: no proposal, the person says which.
   `CONTENT_BOT_PLATFORM_URL` is the address, never typed in full when there
   is a remote: `https://<host>` for GitLab (`https://gitlab.com` or the
   company's own) and for a GitHub Enterprise host, empty for github.com;
   without a remote, GitLab proposes `https://gitlab.com`.
3. **The container engine**: `docker compose version`, else `podman compose
   version`, else `podman-compose version`; the first that answers is the
   engine, written to `.env` as `CONTENT_BOT_ENGINE` (`docker`, `podman` or
   `podman-compose`) for `start` (RQ-0004) to use without asking again. Both
   present: docker. None: a warning that names what to install; the wizard
   goes on (the files are still right).
4. **The site** (`content-bot.config.mjs`), each field proposed from the
   repository and asked:
   - `brand.name`: `package.json` `name` without a scope, else the repository
     name; `title`, `mark` and `subtitle` take their defaults.
   - `build.command`: the package manager from the lockfile (`pnpm-lock.yaml`
     → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm; none → npm), an
     install in `$CLONE`, `node_modules` linked, then its `build` script when
     `package.json` has one; without a `package.json` the command is asked
     with no proposal. `build.output`: the first of `dist`, `build`, `out`,
     `public`, `release/site`, `_site` that exists or that `.gitignore` names,
     else `dist`. `build.describe` is asked, optional.
   - `editable`: the content files found, in this order, each proposed as a
     `text` entry with a generic rule ("the text inside string literals;
     never keys, imports or the structure"): `src/content/*.{ts,js,json}`,
     `src/i18n/**`, `src/locales/**`, `locales/**`, `content/**/*.{json,md}`;
     and `public/**/*.svg` as `svg-text` when an SVG exists under `public/`.
     The person edits the list as `path:kind` entries, comma-separated, and
     the rules afterwards in the file; nothing found: asked with no proposal.
   - `checks`: an install and the `test` script when there is one, else
     `true` with a note to replace it.
   - `deploy`: the job names from the pipeline file. `.gitlab-ci.yml`:
     top-level keys that contain `deploy`; `.github/workflows/*.yml`: the keys
     and `name:` values under `jobs:` that contain `deploy`. The one that also
     contains `release`, `prod` or `tag` is proposed as `production`, the
     other as `test`; one job found: both; none: the defaults
     (`deploy_linux`, `deploy_release`).
   - `version`: `aifactory` when `requirements/` exists in the repository,
     else `patch`.
   - `urls.test`, `urls.production`: asked; `package.json` `homepage` is the
     proposal for production when it is an http(s) URL.
   - `layout`: proposed from the top-level directories that exist among
     `src`, `public`, `app`, `pages`, `components`, `styles`, as "layout,
     code and styles: a/, b/", optional.
   An existing `content-bot.config.mjs` is loaded first and its values are
   the proposals (reconfiguring keeps what was chosen); it is rewritten
   without comments but with every field.
5. **The bot's address**: `CONTENT_BOT_URL`, proposed
   `http://<hostname>:8290` (`os.hostname()`). The port in it is the host
   port the compose file publishes (`CONTENT_BOT_HOST_PORT`, read by compose
   from the same `.env`: `"${CONTENT_BOT_HOST_PORT:-8290}:8290"`); a URL
   without a port (a reverse proxy in front) asks for the host port, proposed
   8290. Inside the container the bot always listens on 8290.
6. **The OAuth application**: the wizard prints where to create it and what
   to enter, then asks for the ID and the secret (the secret is not echoed):
   - GitLab: `<PLATFORM_URL>/groups/<group>/-/settings/applications` (the
     project's group) or the user's `/-/user_settings/applications`; name
     `Content Bot`, redirect URI `<CONTENT_BOT_URL>/auth/callback`,
     confidential, scope `read_user`.
   - GitHub: `<PLATFORM_URL>/settings/developers` (or the organisation's
     `/organizations/<org>/settings/applications`) → New OAuth App; name,
     homepage `<CONTENT_BOT_URL>`, callback `<CONTENT_BOT_URL>/auth/callback`.
7. **The token** (`CONTENT_BOT_TOKEN`, not echoed), with where to make it
   (GitLab: the project's Settings > Access tokens, role Maintainer, scopes
   `write_repository`, `read_api`, `api`; GitHub: a fine-grained token on the
   repository with Contents read/write, Actions read, Metadata read, or a
   classic token with `repo`). Verified at once, through the platform:
   `projectReachable()`; on GitLab `GET /api/v4/personal_access_tokens/self`
   must list `write_repository` and `api` (`read_api` is in `api`); on GitHub
   `GET /repos/<project>` must say `permissions.push`; and `git ls-remote`
   with the token must answer. A failure names the reason and asks again;
   Enter on the empty prompt keeps the token unverified with a warning
   (`--yes`: a failure stops the wizard).
8. **`CONTENT_BOT_MIN_ACCESS`**: proposed 30, named for the platform
   (Developer / write); `CONTENT_BOT_MODEL`: proposed `claude-opus-5-5`.
9. **Written**: `content-bot.config.mjs`; `tools/content-bot/Dockerfile`
   and `compose.yaml` (as today: an existing file is kept and listed);
   `tools/content-bot/.env` with every setting (the optional ones as
   comments when they are at their default), mode `0600`, an existing one
   rewritten with its values kept as the proposals were; `.gitignore` gets
   `tools/content-bot/.env` when it is missing. `.env.example` is no longer
   written (the wizard replaces it; the README keeps the table).
10. **The summary**: what was written and what was kept; "commit
    `content-bot.config.mjs` and `tools/content-bot/{Dockerfile,compose.yaml}`";
    then the engine's `compose up -d --build` command (until RQ-0004's
    `start` takes its place) and the claude login line.

## Without a terminal

- `--yes` takes every proposal without asking; what has no proposal (the
  URLs, the OAuth ID and secret, the token) comes from the flags
  `--url`, `--port`, `--test-url`, `--production-url`, `--oauth-id`, `--oauth-secret`,
  or from the environment (`CONTENT_BOT_TOKEN`, `CONTENT_BOT_OAUTH_SECRET`,
  so secrets are not on a command line); any other setting too has a flag
  of its name (`--platform`, `--project`, `--repo-url`, `--platform-url`,
  `--engine`, `--min-access`, `--model`). A required value with no source
  stops the wizard, naming the flag.
- Without a TTY and without `--yes`, `init` refuses: "init asks questions;
  run it in a terminal or pass --yes with the flags".

## The code

- `src/detect.ts`: the pure findings, each a function of a directory or an
  exec: the remote and its https form, the platform, the engine, the package
  manager, the build output, the content files, the deploy jobs, the version
  policy, the layout, the hostname proposal. No I/O beyond reading the
  repository and running the version commands.
- `src/wizard.ts`: the questions in order, on an `ask` interface
  (`{ question(prompt, proposal), secret(prompt), note(text) }`) that the
  command gives as `readline` on a TTY and a test gives as scripted answers;
  `verifyToken(platform, settings)` with the platform's checks above; the
  writers (`writeEnv`, `writeConfig`, `.gitignore`).
- `commands.ts`: `init` runs the wizard; `--yes` and the flags; the summary.
  `check` reports `CONTENT_BOT_ENGINE` when set (its command answers).
- `assets/init/env.example` is removed; `assets/init/content-bot.config.mjs`
  stays as the documented example (`loadConfig` of it is tested) and the
  README points to it.
- README: *Setting it up for a site* becomes the wizard's story (run it,
  answer, create the OAuth App when it says so, commit the two files, start);
  the manual table stays under *Settings (environment)* for reference, with
  `CONTENT_BOT_ENGINE` and `CONTENT_BOT_HOST_PORT` added.
- Version `0.3.0`.

## Tests

- `tests/detect.test.mjs`: fixture repositories in temp dirs: pnpm + Vite
  (`dist`, `src/content/texts.ts`, SVGs, `.github/workflows/deploy.yml` with
  `deploy-test` and `deploy-production` jobs) → GitHub, pnpm, `dist`, the two
  jobs, patch; the website's shape (`pnpm`, `release/site` in `.gitignore`,
  `.gitlab-ci.yml` with `deploy_linux`/`deploy_release`, `requirements/`) →
  GitLab, aifactory; a bare directory with no `package.json` and no remote →
  everything empty, nothing thrown; an SSH remote to its https form; the
  engine from a fake exec answering docker, podman, both, neither.
- `tests/wizard.test.mjs`: the wizard on the pnpm fixture with scripted
  answers (Enter everywhere, the URLs, OAuth values and a token given): the
  config written loads with the proposed values; `.env` has every variable,
  mode `0600`, secrets present, `CONTENT_BOT_ENGINE`; `.gitignore` gained
  the line; a second run proposes the written values and keeps the
  Dockerfile; the token verification with a fake platform: accepted, a
  GitLab token without `api` refused with the scope named, a GitHub token
  without push refused, `ls-remote` failing refused; the empty answer after
  a refusal keeps the token with a warning; `--yes` stops on it.
- `tests/cli.test.mjs`: `init` without a TTY and without `--yes` exits 2
  with the message; `init --yes` with a missing required value names its
  flag; `init --yes` with the flags and the secrets in the environment on a
  remote the token cannot reach exits 2 with "the token was refused", writes
  nothing and never prints the token (the files `--yes` writes after a
  verified token are covered by `tests/wizard.test.mjs`, which fakes the
  platform; the command cannot without the network); the templates: the
  Dockerfile copies nothing, compose publishes `CONTENT_BOT_HOST_PORT`, no
  `env.example`.

## Acceptance Criteria

- `init` in a clone with a GitHub remote proposes GitHub, the project, the
  package manager, the output, the content files, the deploy jobs and the
  policy from the repository, and with Enter on every proposal plus the
  URLs, the OAuth values and a token writes a config that `loadConfig`
  accepts and a `.env` (mode `0600`) that `check` passes on its variables.
- The same in a clone shaped like the website proposes GitLab, aifactory,
  `release/site`, `deploy_linux`/`deploy_release`.
- The platform is the first question and `CONTENT_BOT_PLATFORM_URL`, the
  OAuth instructions, the token instructions and the token checks follow it.
- The engine is detected (docker, podman, podman-compose, none) and written;
  none warns and does not stop.
- A wrong token is refused at the wizard with the reason (GitLab scopes,
  GitHub push, the repository not answering), and can be retried.
- `.env` is never committed: `.gitignore` names it; it is written `0600`.
- Rerunning `init` proposes the current values and keeps the Dockerfile and
  the compose file.
- `--yes` with flags and environment secrets runs without a TTY; without
  `--yes` and without a TTY `init` exits 2 with the message.
- README describes the wizard; `grep -rn -i "bytecraft\|bc\.int\|192\.168\."
  src assets tests README.md` finds the README example only.
- `package.json` version `0.3.0`; `pnpm typecheck`, `pnpm test`,
  `pnpm pack:check`, `pnpm template:check` pass.
