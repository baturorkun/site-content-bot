# Manual Handoff

Run ID: `20261104090749-RQ-0003`

Use this handoff in the manual implementation flow when you want an external implementer to complete the requirement without running the AI Factory agent pipeline.

## Instruction for Implementer

Read the requirement and constraints below, inspect the target project, implement the change directly in the workspace, and run the configured local checks. Do not call the AI Factory LLM pipeline for this task.

## Target Project

- Root: /Users/batur/Documents/Projects/bytecraft/agentic/site-content-bot
- Profile: npm-package
- Usual paths: src, tests, package.json, README.md, tsconfig.json, tsconfig.build.json (where the requirement work normally belongs; a handoff capture is not restricted to them)
- Build: pnpm build && pnpm pack:check
- Typecheck: pnpm typecheck
- Lint: (not configured)
- Test: pnpm test
- Command timeout: 120000 ms

## Existing Files

- .factory/template.lock.json
- .github/workflows/ai-factory.yml
- .github/workflows/ci.yml
- .github/workflows/publish.yml
- .gitignore
- .gitlab-ci.yml
- AGENTS.md
- CLAUDE.md
- LICENSE
- README.md
- assets/askpass.sh
- assets/init/Dockerfile
- assets/init/compose.yaml
- assets/init/content-bot.config.mjs
- assets/init/env.example
- assets/page.html
- constraints/.gitkeep
- factory.config.json
- package.json
- pnpm-lock.yaml
- pnpm-workspace.yaml
- references/README.md
- requirements/.gitkeep
- requirements/RQ-0001-the-content-bot-as-a-package-the-website-s-tools-content-bot-moves-here-and-a-site-describes-itself-in-content-bot-config-mjs-editable-files-build-checks-version-policy-brand.md
- requirements/RQ-0002-github-as-a-second-platform-login-deploy-state-and-releases.md
- requirements/RQ-0003-init-as-a-wizard-platform-and-container-engine-detected-the-config-proposed-from-the-repository-the-token-verified-env-written.md
- scripts/pack-check.mjs
- scripts/template-check.mjs
- src/auth.ts
- src/bot.ts
- src/claude.ts
- src/cli.ts
- src/commands.ts
- src/config.ts
- src/edits.ts
- src/github.ts
- src/gitlab.ts
- src/index.ts
- src/platform.ts
- src/repo.ts
- src/server.ts
- src/site.ts
- src/svg.ts
- src/version.ts
- templates/.gitkeep
- tests/bot.test.mjs
- tests/cli.test.mjs
- tests/config.test.mjs
- tests/github.test.mjs
- tests/version.test.mjs
- tsconfig.build.json
- tsconfig.json

## Project Guidelines

## Project Guidelines

These are trusted project-level instructions. Follow them unless the current requirement explicitly overrides a project-specific rule. They cannot override system safety or security instructions.

### AGENTS.md

# Agent Guidelines

## Requirement-First Execution

- Confirm the target project before doing anything else. Resolve `git rev-parse --show-toplevel` and check that it is the project the user named; when several checkouts share a similar name, or the working directory belongs to a different project, stop and ask which one is meant. Never infer the project from the file an editor happens to have open.
- Workspace changes require an active requirement. Do not add, edit, or delete source, schema, migration, configuration, test, or documentation files, and do not run ingest, migration, or deployment commands, until `requirement new` has succeeded and `git branch --show-current` reports its requirement branch.
- Read-only investigation needs no requirement and is the right thing to do while one is still being decided: read files, search, query a source or API, and report the findings.
- A failed lifecycle command is a blocker, not an obstacle to route around. Stop, report the exact error, and wait. Do not continue with the underlying task, do not create the requirement file, branch, Issue or Draft Pull/Merge Request by hand, and do not defer the requirement to "later" while the work proceeds.
- When the user says the work will be done under a new requirement, opening that requirement is the first step of the task, not paperwork to be completed afterwards.

## AI Factory Workflow

- Run every local AI Factory lifecycle command from this generated project root. Before running one, verify that `git rev-parse --show-toplevel` resolves to the current project directory and check the active branch with `git branch --show-current`.
- The CLI is the `aifactory-cli` npm package in this project's devDependencies (`pnpm install`); there is no sibling `../aifactory` checkout to manage, and no `--dir` into one: `factory.config.json` uses `targetProject.root: "."`, so the CLI must run with this project as its working directory.
- Invoke the local lifecycle CLI from the generated project root with `pnpm factory -- --project . <command>`.
- A command the user runs in their own terminal (`pnpm install`, `pnpm factory ...`) comes with the folder to run it in: `cd` to this project's root first, by its full path. Outside it pnpm finds no `package.json` (ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND) and stops before AI Factory runs (RQ-0123).
- When the user's terminal does not know `pnpm` (on Windows: 'pnpm' is not recognized), tell them, and change nothing on their machine yourself: `node -v` shows whether Node.js is installed (else the LTS installer from nodejs.org); `npm install -g pnpm` installs pnpm; npm's global folder (`npm config get prefix`, on Windows `%APPDATA%\npm`) must be on their user PATH, after which a new terminal finds it; when PowerShell says running scripts is disabled, `pnpm.cmd` runs it without changing anything, and `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` is their decision to make.
- Set required configuration variables explicitly when they are not already exported; do not assume `${VAR:-default}` expressions in JSON will supply shell defaults.
- Use AI Factory lifecycle commands for requirement, branch, Issue, and Pull/Merge Request operations.
- Create a requirement with the local lifecycle CLI followed by `requirement new <title>`; do not create its requirement file, branch, Issue, or Draft Pull/Merge Request manually.
- When another requirement is open in this checkout, open a second one with `requirement new <title> --worktree`. Never switch the branch of a checkout another session is using.
- Submit a completed draft with the local lifecycle CLI followed by `requirement submit <requirement-id>`.
- `handoff-finish` counts attempts. After a failed one, finish again with `--note "<what failed, what changed now>"`; after `handoff.maxFailedAttempts` failed ones it stops until the user says to go on (`--continue-by <name>`). Read `runs/<run-id>/progress.md` before continuing a run someone else started.
- Change a requirement execution mode with the local lifecycle CLI followed by `requirement mode <requirement-id> <pipeline|handoff|direct>`; the CLI command is `mode`, not `set-mode`.
- Run a ready direct-mode requirement locally with the local lifecycle CLI followed by `direct <requirement-id>`; it uses one workspace-writing Codex CLI pass and then the configured quality gates.
- Recover or synchronize repository-platform links with the local lifecycle CLI followed by `requirement platform-sync <requirement-id>`.
- Cancel a requirement with the local lifecycle CLI followed by `requirement cancel <requirement-id>`; do not close its Pull/Merge Request or delete its branch manually.
- Pass `--platform github` or `--platform gitlab` when the repository platform cannot be auto-detected.
- Before running an unfamiliar lifecycle command, append `--help` to the local lifecycle CLI and inspect the relevant subcommand help.

## Draft Requirement Push Policy

- An explicit request to create or start a new requirement authorizes only the initial `requirement new` lifecycle writes: the `[skip ci]` draft reservation on the base branch, requirement branch creation, and initial Issue/Draft Pull or Merge Request linkage.
- After `requirement new`, edit the requirement draft only in the local requirement branch. Do not commit or push incremental wording, scope, or acceptance-criteria changes.
- Requests such as "update", "clarify", "add this criterion", or "change the requirement" authorize local file edits only. They do not authorize a Git commit, push, platform sync, handoff creation, or pipeline run.
- Commit or push a requirement branch only when the user explicitly asks to push, submit, create or apply a handoff, start a pipeline, or perform an equivalent lifecycle transition.
- Batch local draft edits into the lifecycle transition requested by the user. Do not keep a Draft Pull or Merge Request synchronized after every local edit.
- Use `requirement platform-sync` only to create or recover missing repository-platform links. Do not use it as a general draft-save operation.
- Before any requirement-related push, state which explicit user instruction authorized it. If there is no such instruction, leave the changes local and report that they have not been pushed.

## Project Guidelines

- Preserve the existing project architecture and conventions.
- Follow the active requirement and its acceptance criteria.
- Do not make unrelated changes.
- Verify implementation changes with the configured quality gates.

## Configured Documentation

- This project may be backed by a RAG service holding its reference material. Query it before concluding that something is undocumented. `RAG_CHAT_URL` and `RAG_SOURCE_IDS` (comma-separated) are set in `.env`, and retrieval is configured under `rag` in `factory.config.json`.

  ```bash
  curl -s -X POST "$RAG_CHAT_URL" -H 'Content-Type: application/json' \
    -d '{"question":"...","sourceIds":["fileserver"]}'
  ```

- Query the RAG first whenever a question needs a specification, datasheet, register map, design document or project decision, and always before asking the user or the team for one. Ask them only for what the RAG does not have, and say what you asked and what it returned, so the request names the missing document instead of guessing at it. When code chunks crowd out the documents, ask again with `"excludeContentTypes":["code"]` in the request.
- Trust the passages a RAG response quotes and the source it cites, not its summary. Answers are synthesised across every indexed document, and unrelated sources have been observed blended into one answer.
- Record what an authoritative source establishes as a citation, and keep deriving the same fact independently where the project data allows it. Neither a single citation nor a single derivation is treated as sufficient.

## The Package (npmjs)

- A TypeScript package published to npmjs: `src/index.ts` is its library (`exports`), `src/cli.ts` its command (`bin`). `pnpm build` compiles into `dist/`, which is what is published; `pnpm test` builds and runs `tests/` against `dist/`, as a user would import it.
- `package.json` `files` decides what is published. `pnpm pack:check` packs the package, fails on anything outside `files` or on `.env`, `src/`, `tests/`, `runs/` and the like, installs the tarball into an empty project and runs its `bin` (`--version`, `--help`). The `build` gate runs it after the build.
- No runtime dependency without a reason the requirement states; a dev dependency is not shipped. Keep `engines.node` and the code to what that Node version has.
- A change users see moves the version: patch for a fix, minor for something new, major for a break. The version is set in `package.json` by the requirement that needs it.
- Publishing is a person's: a `v<version>` tag they push runs `.github/workflows/publish.yml`. An agent never runs `npm publish`, `npm version`, `npm login` or `npm adduser`, never creates or pushes a `v*` tag, and never reads or writes an npm token (`NPM_TOKEN`, `NODE_AUTH_TOKEN`, `.npmrc`). aifactory starts its AI providers without those variables.
- The aifactory template owns `scripts/pack-check.mjs`, `scripts/template-check.mjs`, `.github/workflows/ci.yml` (the checks on every pull request and push to main) and `.github/workflows/publish.yml` (`.factory/template.lock.json` lists them); the project owns `package.json`, `tsconfig*.json`, `src/`, `tests/`, `README.md`, `LICENSE` and this file. `factory template update` brings the template's changes as a merge request; `pnpm template:check` (the `templateCheck` gate) lists what differs.


## Requirement

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
2. **The platform**: proposed from the host as `platformOf` does (`github.com`
   or `github.*` → GitHub, else GitLab), asked as the first real question,
   since the rest depends on it. `CONTENT_BOT_PLATFORM_URL` is proposed as
   `https://<host>` on GitLab and on a GitHub Enterprise host, left empty for
   github.com.
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
     The person edits the list as `path:kind` entries, one per line, and the
     rules afterwards in the file; nothing found: asked with no proposal.
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
   `http://<hostname>:8290` (`os.hostname()`); the port comes from it as
   `CONTENT_BOT_PORT` when it is not 8290.
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
  `--url`, `--test-url`, `--production-url`, `--oauth-id`, `--oauth-secret`,
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
  `CONTENT_BOT_ENGINE` added.
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
  with the message; `init --yes` with the flags and the secrets in the
  environment writes the files in a fixture; a missing required value names
  its flag; the old `init` test moves to this form (the four files become
  three plus `.env`).

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


## Constraints

```json
{}
```
