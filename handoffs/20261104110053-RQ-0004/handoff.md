# Manual Handoff

Run ID: `20261104110053-RQ-0004`

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
- scripts/pack-check.mjs
- scripts/template-check.mjs
- src/auth.ts
- src/bot.ts
- src/claude.ts
- src/cli.ts
- src/commands.ts
- src/config.ts
- src/detect.ts
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
- src/wizard.ts
- templates/.gitkeep
- tests/bot.test.mjs
- tests/cli.test.mjs
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
id: RQ-0004
status: ready
executionMode: handoff
pipelineFast: false
createdByName: "Batur Orkun"
createdByEmail: "batur@bc.int"
createdAt: "2026-11-04T10:58:35.732Z"
branch: "factory/RQ-0004"
createdFromCommit: "0808a4c0c26ef8b6e4640ce687355426153c1a51"
githubPullRequestUrl: "https://github.com/baturorkun/site-content-bot/pull/8"
githubPullRequestIid: 8
githubIssueUrl: "https://github.com/baturorkun/site-content-bot/issues/7"
githubIssueIid: 7
repositoryProvider: github
---
# RQ-0004 - codex as a second LLM: CONTENT_BOT_LLM chooses claude or codex, the wizard asks, check probes its login

The bot answers with one model CLI today, `claude` (the subscription, no API
key; `src/claude.ts`). A site whose people have a ChatGPT subscription, or an
OpenAI key, cannot use it. This requirement adds the `codex` CLI as a second
choice behind the same `Ask` the bot already calls, so the rest of the bot
(the prompt's rules, the edits, the guard, the push, the release) does not
change. The container has both CLIs; `.env` chooses.

## Choosing

- `CONTENT_BOT_LLM`: `claude` (default) or `codex`; anything else refuses
  `serve` and fails `check`, naming the two.
- `CONTENT_BOT_MODEL`: the chosen CLI's model; default `claude-opus-5-5` for
  claude, empty for codex (codex's own default; `--model` is then not passed).
- `CLAUDE_EXECUTABLE` (default `claude`) and `CODEX_EXECUTABLE` (default
  `codex`).
- `src/llm.ts`: `LLM_NAMES`, a description of each (the provider label the
  page shows, the default model, how it reads the copies, how to log in) and
  `makeAsk({ llm, executable, model })` giving the bot its `Ask`.

## codex

- `src/codex.ts` `askCodex({ executable, model, prompt, schema, dirs,
  timeoutMs })`, as aifactory's codex-cli adapter runs it:
  `codex --sandbox read-only --ask-for-approval never --cd <throwaway dir>
  [--model <model>] exec --ephemeral --ignore-user-config --color never
  --skip-git-repo-check --output-last-message <file> --output-schema <file> -`,
  the prompt on stdin. The throwaway working directory keeps any project
  `AGENTS.md` from being read as instructions; the read-only sandbox lets it
  read the copies (their absolute paths are in the prompt, as for claude)
  and write nothing, with no network.
- The answer is the last message, parsed as the JSON of the schema; an empty
  or non-JSON message is refused, named. A failure whose output says it is
  not logged in (`login`, `401`, `unauthorized`, `auth`) becomes the codex
  login message: "Codex is not logged in in the container: run `codex login
  --device-auth` in it (docker exec -it <container> codex login
  --device-auth)". A missing executable and a timeout are named as for
  claude.
- The prompt's first lines say how the model reads: for claude "with Read,
  Glob and Grep" (unchanged), for codex "with read-only shell commands (ls,
  cat, rg) in a read-only sandbox"; `ContentBot` takes it as `reads`.

## Wiring

- `serve` builds the `Ask` from `CONTENT_BOT_LLM`; the page's Model and
  Provider show the chosen one (`codex-cli` or `claude-cli (subscription)`);
  the start line names it.
- `check` reports the LLM chosen and probes it (a one-line JSON answer, as it
  does for claude today), with the login message on failure.
- The wizard (RQ-0003) asks "The language model CLI (claude, codex)",
  proposal the current value or `claude`, then the model with the chosen
  CLI's default; `.env` gets `CONTENT_BOT_LLM`; the summary's login line is
  the chosen CLI's (`claude` + `/login`, or `codex login --device-auth`).
  Flags `--llm`, `--model` for `--yes`.
- `assets/init/Dockerfile` installs both CLIs at fixed versions
  (`@anthropic-ai/claude-code@2.1.312`, `@openai/codex@0.166.0`); `HOME`
  (`/data/home`) keeps both logins in the volume.
- README: a section *The language model* (the two, how each reads, how each
  logs in, the variables), the settings table.
- Version `0.4.0`.

## Tests

- `tests/codex.test.mjs` with a fake `codex` executable (records its working
  directory, arguments and stdin; writes the last-message file from a
  fixture): the arguments (read-only sandbox before `exec`, approval never,
  the schema file holds the schema, `--model` only when given, `-` last),
  the prompt on stdin, the throwaway directory removed, the answer parsed;
  an empty message, a non-JSON message, a non-zero exit, a login failure
  (the codex message), a missing executable.
- `tests/bot.test.mjs`: the prompt with `reads` for codex.
- `tests/cli.test.mjs`: `serve` refusing an unknown `CONTENT_BOT_LLM`;
  `check` naming the LLM and probing the codex executable it is given.
- `tests/wizard.test.mjs`: the LLM question, `CONTENT_BOT_LLM` in `.env`,
  the codex model default empty, the summary's codex login line.

## Acceptance Criteria

- `CONTENT_BOT_LLM=codex` makes the bot answer through `codex exec` in a
  read-only sandbox with the answer schema; `claude` (and unset) behaves as
  before, byte for byte in its arguments.
- An unknown `CONTENT_BOT_LLM` is refused by `serve` and reported by `check`.
- A codex that is not logged in gives the codex login message on the page
  and in `check`.
- The wizard asks the LLM, writes it, and names its login in the summary.
- The Dockerfile installs both CLIs at fixed versions.
- `grep -rn -i "bytecraft\|bc\.int\|192\.168\." src assets tests README.md`
  finds the README example only.
- `package.json` version `0.4.0`; `pnpm typecheck`, `pnpm test`,
  `pnpm pack:check`, `pnpm template:check` pass.


## Constraints

```json
{}
```
