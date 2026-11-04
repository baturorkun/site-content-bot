# Manual Handoff

Run ID: `20261104113344-RQ-0005`

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
- requirements/RQ-0004-codex-as-a-second-llm-content-bot-llm-chooses-claude-or-codex-the-wizard-asks-check-probes-its-login.md
- requirements/RQ-0005-a-ready-image-on-ghcr-init-writes-only-compose-and-start-stop-logs-status-update-and-login-run-the-container.md
- scripts/pack-check.mjs
- scripts/template-check.mjs
- src/auth.ts
- src/bot.ts
- src/claude.ts
- src/cli.ts
- src/codex.ts
- src/commands.ts
- src/config.ts
- src/detect.ts
- src/edits.ts
- src/github.ts
- src/gitlab.ts
- src/index.ts
- src/llm.ts
- src/platform.ts
- src/repo.ts
- src/server.ts
- src/site.ts
- src/svg.ts
- src/version.ts
- src/wizard.ts
- templates/.gitkeep
- tests/bot.test.mjs
- tests/cli.test.mjs
- tests/codex.test.mjs
- tests/config.test.mjs
- tests/detect.test.mjs
- tests/github.test.mjs
- tests/version.test.mjs
- tests/wizard.test.mjs
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
id: RQ-0005
status: ready
executionMode: handoff
pipelineFast: false
createdByName: "Batur Orkun"
createdByEmail: "batur@bc.int"
createdAt: "2026-11-04T11:32:48.589Z"
branch: "factory/RQ-0005"
createdFromCommit: "ac2b105cc1b82b5d7c310a636551ad54114ffd3f"
githubPullRequestUrl: "https://github.com/baturorkun/site-content-bot/pull/10"
githubPullRequestIid: 10
githubIssueUrl: "https://github.com/baturorkun/site-content-bot/issues/9"
githubIssueIid: 9
repositoryProvider: github
---
# RQ-0005 - a ready image on GHCR, init writes only compose, and start, stop, logs, status, update and login run the container

After `init` (RQ-0003) a person still builds a container from a Dockerfile
the wizard put into the site's repository, runs `docker compose` and `docker
exec` by hand, logs the model CLI in by hand, and edits the Dockerfile to
update the bot. This requirement makes the container a product of this
package and its running a set of commands:

- every release (`v*` tag) also publishes a ready image,
  `ghcr.io/baturorkun/site-content-bot:<version>` (and `:latest`), with both
  model CLIs and the bot of that version;
- `init` writes only `tools/content-bot/compose.yaml` (and `.env`), the
  image named in it; nothing is built on the host;
- `site-content-bot start | stop | logs | status | update | login`, run in
  the site's clone on the host, drive that container with the engine the
  wizard found, and `start` logs the chosen model CLI in when it is not.

## The image

- `docker/Dockerfile` in this repository (not in the npm package):
  `node:20-bookworm-slim`, git and ca-certificates, both model CLIs at fixed
  versions (`@anthropic-ai/claude-code@2.1.312`, `@openai/codex@0.166.0`),
  pnpm and yarn through corepack, and this package installed from the
  tarball the workflow packs (`npm pack` of the tagged commit), so the image
  runs exactly the tagged code and does not wait for npm. `/data` volume,
  `HOME=/data/home`, user `node`, port 8290, the health check on `/healthz`,
  `CMD ["site-content-bot", "serve"]`, OCI labels (`source` this repository,
  `version`, `description`).
- `.github/workflows/image.yml` (this project's, not the template's): on a
  pushed `v*` tag (and by hand with a tag), the tag checked against
  `package.json`, `pnpm install`, `pnpm build`, `npm pack`, then
  `docker buildx` for `linux/amd64` and `linux/arm64`, pushed to GHCR with
  the workflow's `GITHUB_TOKEN` (`packages: write`). By hand without a tag: a
  build without a push. The tag is pushed by a person, as for npm.
- The first image makes the GHCR package; whether it is public is the
  owner's setting on GitHub (Packages > site-content-bot > visibility). The
  README says so; nothing in the package can set it.

## The compose file

- `assets/init/compose.yaml`:
  `name: ${CONTENT_BOT_CONTAINER:-site-content-bot}` (the project, so two
  sites on one host have their own volume),
  `image: ${CONTENT_BOT_IMAGE:-ghcr.io/baturorkun/site-content-bot:{{version}}}`,
  `container_name: ${CONTENT_BOT_CONTAINER:-site-content-bot}`,
  `restart: unless-stopped`, `env_file: .env`, the host port
  `${CONTENT_BOT_HOST_PORT:-8290}:8290`, the `/data` volume. No `build:`.
- `init` writes it with this version; `assets/init/Dockerfile` is removed and
  `init` no longer writes one (an existing one is left, and the summary says
  it is no longer used).
- The wizard asks the container's name (proposal `site-content-bot`, the
  current value when rerun) and writes `CONTENT_BOT_CONTAINER` (a comment at
  the default); `CONTENT_BOT_IMAGE` is documented, not asked (a site that
  needs more tools in the image builds `FROM` this one and names its own).

## The commands

All run in the site's clone (or `--dir`), read `tools/content-bot/.env`, and
run the engine's compose with `-f tools/content-bot/compose.yaml` in
`tools/content-bot/` (so compose reads that `.env`). The engine is
`CONTENT_BOT_ENGINE`, else detected (RQ-0003); none: refused, naming what
to install. `exec` and `inspect` are `docker` for docker and `podman` for
both podman engines. A missing compose file or `.env`: "run site-content-bot
init first".

- `start`: `compose up -d` (pulling the image when it is not there); waits
  for the container to be healthy (`<engine> inspect` of its health, every
  2 s, 180 s at most; unhealthy or gone: the last log lines and exit 1);
  then runs `site-content-bot check` in it. When the model line fails with
  the CLI's not-logged-in message and stdin is a terminal, it runs the
  chosen CLI's login in the container interactively (`claude`, with the note
  "type /login, then /exit"; `codex login --device-auth`) and checks again;
  without a terminal it prints the login command and exits 1. Ends with the
  bot's address (`CONTENT_BOT_URL`). Other check failures are printed and
  exit 1, the container left running.
- `stop`: `compose down` (the volume, so the clone, the copies and the
  logins, stays).
- `logs [--follow]`: `compose logs [--follow] --tail 200`.
- `status`: `compose ps`, then `check` in the container when it runs; exit 1
  when it does not run or the check fails.
- `update [--to <version>]`: the image's default tag in `compose.yaml`
  becomes `--to` or this CLI's own version (`npx site-content-bot@latest
  update` therefore updates to the latest); a compose file that uses
  `build:` or names another image is refused, naming what to change. Then
  `compose pull`, `compose up -d`, the wait and the check as in `start`.
  A version that is not `MAJOR.MINOR.PATCH`: refused.
- `login`: the chosen CLI's login in the container, interactively (when the
  login has expired); without a terminal: refused, printing the command.
- Each prints the command it runs before it runs it.

## The code

- `src/container.ts`: the engine's commands (`composeCommand` from detect.ts,
  `runner(engine)` for exec and inspect), `readSite(dir)` (the compose path,
  the `.env` values, the engine), `start`, `stop`, `logs`, `status`,
  `update`, `login`, each on an `exec` interface (spawn with inherited stdio
  for the interactive and the streaming ones) that the tests replace.
- `commands.ts`: the six commands, `--dir`, `--follow`, `--to`; the help.
- The wizard's summary: `site-content-bot start` instead of the compose and
  exec lines.
- README: *Setting it up* ends with `start`; a section *Running it* (the six
  commands, the image, its visibility, building `FROM` it, two sites on one
  host).
- Version `0.5.0`.

## Tests

- `tests/container.test.mjs`, with a fake engine on the path (records its
  arguments and working directory; `inspect` answers starting then healthy,
  or unhealthy; `exec … site-content-bot check` answers from a fixture):
  `start` runs `compose -f … up -d` in `tools/content-bot/`, waits, checks,
  prints the address; a not-logged-in check without a terminal prints the
  login command for claude and for codex and exits 1; an unhealthy
  container exits 1 with the logs; `stop`, `logs --follow`, `status`
  (running and not); `update` rewrites the tag (to `--to`, to the CLI's
  version), refuses `build:` and another image and a bad version; `login`
  without a terminal refused; podman uses `podman compose` and `podman exec`,
  podman-compose `podman-compose` and `podman exec`; no compose file: "run
  site-content-bot init first"; no engine: refused.
- `tests/cli.test.mjs`: the help lists the six commands; the templates: no
  Dockerfile, compose names the GHCR image with this version and has no
  `build:`.
- `tests/wizard.test.mjs`: no Dockerfile written; `CONTENT_BOT_CONTAINER`;
  the summary names `site-content-bot start`.
- `tests/image.test.mjs`: `docker/Dockerfile` installs both CLIs at fixed
  versions and the packed tarball, has the health check, the volume and the
  labels; `image.yml` runs on `v*` tags, checks the tag against
  `package.json`, builds both platforms and pushes only on a tag;
  `docker/` is not in the npm package's `files`.

## Acceptance Criteria

- A `v*` tag publishes `ghcr.io/baturorkun/site-content-bot:<version>` and
  `:latest` for amd64 and arm64 from the tagged code (verified on the first
  release; the workflow and the Dockerfile are tested here).
- `init` writes compose (the image, this version, no `build:`) and `.env`;
  no Dockerfile.
- `start` brings the container up, waits for it to be healthy, checks it,
  logs the chosen CLI in on a terminal, and prints the address; `stop`,
  `logs`, `status`, `update`, `login` do what is described, with docker,
  podman and podman-compose.
- Two sites on one host: different `CONTENT_BOT_CONTAINER` and host ports
  give two containers and two volumes.
- `grep -rn -i "bytecraft\|bc\.int\|192\.168\." src assets tests docker
  README.md` finds the README example only.
- `package.json` version `0.5.0`; `pnpm typecheck`, `pnpm test`,
  `pnpm pack:check`, `pnpm template:check` pass.


## Constraints

```json
{}
```
