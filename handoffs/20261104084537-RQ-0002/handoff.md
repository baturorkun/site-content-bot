# Manual Handoff

Run ID: `20261104084537-RQ-0002`

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
id: RQ-0002
status: ready
executionMode: handoff
pipelineFast: false
createdByName: "Batur Orkun"
createdByEmail: "batur@bc.int"
createdAt: "2026-11-04T07:41:42.185Z"
branch: "factory/RQ-0002"
createdFromCommit: "229051bfb1eff32069d8dccd6454bcabda8d6f86"
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


## Constraints

```json
{}
```
