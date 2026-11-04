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
