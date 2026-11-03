---
id: RQ-0001
status: draft
executionMode: handoff
pipelineFast: false
createdByName: "Batur Orkun"
createdByEmail: "batur@bc.int"
createdAt: "2026-11-03T19:27:10.316Z"
branch: "factory/RQ-0001"
createdFromCommit: "a161bf3af1929e9932ed0afe64354b3e9de7c6ca"
githubPullRequestUrl: "https://github.com/baturorkun/site-content-bot/pull/2"
githubPullRequestIid: 2
githubIssueUrl: "https://github.com/baturorkun/site-content-bot/issues/1"
githubIssueIid: 1
repositoryProvider: github
---
# RQ-0001 - The content bot as a package: the website's tools/content-bot moves here, and a site describes itself in content-bot.config.mjs (editable files, build, checks, version policy, brand)

The Bytecraft website has an internal chat, `tools/content-bot/` in the
website repository (its RQ-0021, RQ-0022): a person logs in with GitLab, asks
about the site or writes what text should change, in any language; the bot
reads read-only copies of main, the built test site and the production
release with the `claude` CLI (`Read`, `Glob`, `Grep` only, no API key), shows
the change as old and new text, **Apply** pushes one commit to main (authored
by the person, `Requested-by:` and `Content-bot:` trailers) after the site's
own checks pass, **Undo** reverts the latest one, **Recent changes** shows
where each commit is (pipeline, test, production), and **Release…** ships what
the test site serves as a GitLab Release with a fixed version.

That bot becomes this package, so any site can have it. Everything about *the
bot* (the chat, the login, the clone, the edits, the guard, the release flow,
the page) moves here unchanged in behaviour; everything about *the website*
(which files hold its texts, how it builds, what its checks are, how its
version is formed, its name) leaves the code and becomes a config file the
site keeps in its own repository. The site runs the bot from a container built
on this package and a `.env` on the host, as today. Nothing in this package
knows Bytecraft, its hosts or its addresses: the website's values appear only
in the README as an example and in the tests as fixtures.

## The package

- `src/` holds the bot as TypeScript: the modules of the website's
  `tools/content-bot/lib/` (`auth`, `bot`, `claude`, `edits`, `gitlab`,
  `repo`, `site`, `svg`) and its `server.mjs`, one file each, plus `config.ts`
  (the config file: load, validate, defaults) and `version.ts` (the version
  policies). The port keeps the behaviour, the names and the comments; types
  stay as loose as the JavaScript was where a precise type would mean
  rewriting (`unknown`, a small interface, an `as`). `pnpm build` compiles
  it to `dist/`.
- `assets/page.html` is the page, shipped as it is (`files`); the server reads
  it beside `dist/`. Its brand strings (the mark, the title, the subtitle, the
  login sentence, the site's name in the welcome text) come from `/api/me`
  (the config's `brand` and the GitLab host and project), not from the HTML.
- `src/index.ts` exports what a site or a test needs: `createApp`,
  `ContentBot`, `Repo`, `Site`, `GitLabAuth`, `askClaude`, `applyEdits`,
  `applyFileEdits`, `onlyTextChanged`, `loadConfig`, `versionPolicies`.
- No runtime dependency: the bot uses Node's modules only, as it does today.
  `engines.node` stays `>=20`.
- The version of this package stays `0.1.0`: it has not been published.

## The CLI

`site-content-bot <command>`:

- `serve [--config <path>]`: starts the bot (today's `node server.mjs`).
  Settings come from the environment as today (the table below); the site's
  description comes from the config file. The clone is made or synced first,
  then the config is read from the clone's root (`content-bot.config.mjs`),
  unless `--config` names a file; a config that fails to load or validate
  stops the start with the reason. The config is read once; a changed config
  takes effect on restart (the README says so).
- `check [--config <path>]`: reports, one line each, and exits 1 on a failure:
  each required variable present; the repository reachable with the token
  (`git ls-remote`); the config loads and validates, with the policies and
  the editable patterns it declares; the `claude` executable found and logged
  in (the probe `claude.mjs` makes today, "Claude is not logged in" otherwise);
  GitLab's API reachable with the token (`/api/v4/projects/<project>`).
- `init [--dir <path>]`: writes into a site what it needs to run the bot:
  `content-bot.config.mjs` (the example below, with comments, every field),
  `tools/content-bot/Dockerfile`, `tools/content-bot/compose.yaml` and
  `tools/content-bot/.env.example` (the variables below, values empty). An
  existing file is left alone and listed as kept. The Dockerfile installs the
  `claude` CLI and this package globally (`npm install --global
  @anthropic-ai/claude-code site-content-bot@<this version>`) on
  `node:20-bookworm-slim` with git, and runs `site-content-bot serve`; it
  copies nothing of the site, the clone is made at run time into the `/data`
  volume (the clone, the copies Claude reads, the claude login home), as the
  website's Dockerfile does. The compose file is the website's with the
  image name `site-content-bot:local`.
- `--help`, `--version` as the template has them.

## The config file: `content-bot.config.mjs`

An ES module at the site repository's root, default export an object:

```js
export default {
  // How the page names the site and itself.
  brand: { mark: 'BC', name: 'Bytecraft website', title: 'Content Bot', subtitle: "The Bytecraft website's texts" },
  // What the bot may change. kind 'text': any text in the file, under the rule
  // in `rule` (goes to the prompt); kind 'svg-text': the text inside <text>
  // and <tspan> only, markup untouched (svg.ts).
  editable: [
    { path: 'src/content/site-content.ts', kind: 'text',
      rule: 'the text inside string literals (content.tr is Turkish, content.en English); never keys, types, imports, paths, functions or the structure; keep the TypeScript valid (escape quotes as the file does)' },
    { glob: 'public/**/*.svg', kind: 'svg-text' },
  ],
  // One line for the prompt: where the rest of the site is, for questions.
  layout: 'layout, code and styles: src/, public/index.html',
  // Left out of the copies Claude reads (default: runs, handoffs, .factory).
  exclude: ['runs', 'handoffs', '.factory'],
  // How a copy of main becomes what the test domain serves (run in that copy,
  // CLONE set to the clone, whose node_modules it may use) and what it made.
  build: {
    command: 'pnpm --dir "$CLONE" install --frozen-lockfile --prefer-offline >/dev/null && ln -s "$CLONE/node_modules" node_modules && node node_modules/typescript/bin/tsc --project tsconfig.build.json && sh scripts/release.sh >/dev/null',
    output: 'release/site',
    describe: 'index.html (English), tr/index.html (Turkish), public/, dist/',
  },
  // The site's checks before a push; a failure pushes nothing.
  checks: 'pnpm install --frozen-lockfile --prefer-offline >/dev/null && node node_modules/typescript/bin/tsc --noEmit && node --test tests/prerender.test.mjs',
  // The next release's version: a policy name or a function (below).
  version: 'aifactory',
  urls: { test: 'https://test.example.com', production: 'https://example.com' },
};
```

- `editable` (required, non-empty): each entry `path` (one file) or `glob`
  (`*` within a segment, `**` across segments, no `..`), with `kind` `text` or
  `svg-text`; `rule` optional for `text`, ignored for `svg-text` (its rule is
  fixed: text inside `<text>`/`<tspan>`, no `<`, `>` or `&`). `edits.ts`'s
  `isEditable`/`isSvg` and the prompt's "You may change only" list are built
  from this; the guard refuses anything else, as today.
- `build` (required: `command`, `output`; `describe` optional), `checks`
  (required), `exclude` (optional, default as above), `layout` (optional),
  `brand` (required: `name`; others default to `Content Bot`, the name's
  initials as the mark, "The <name>'s texts"), `urls` (required: `test`,
  `production`), `version` (optional, default `aifactory`).
- Validation names the field and what is wrong; unknown top-level fields are
  an error (a typo would otherwise silently become a default).
- `GITLAB_URL`, the project, tokens, the bot's own URL and port stay in the
  environment: they are about where the bot runs, not about the site.

## Version policies (`version.ts`)

What `Release…` offers as the next version, fixed, not chosen, and the
message when there is nothing to release:

- `aifactory` (the website's rule today, moved from `repo.mjs`'s `rqVersion`):
  `1.<N>.<run>`, N the highest completed requirement under `requirements/` at
  the candidate commit, run the largest `retries` in that requirement's
  `completedRunId` manifest, `1.0.0` with none; "already runs" when production
  has that tag; the status bar shows the requirement versions of main and
  production as today.
- `patch`: production's tag with the patch number raised (`v1.0.0` with no
  release); anything to release means a new version, so "already runs" cannot
  happen and the status bar shows only the tags.
- A function `({ candidate, production, read }) => string | Promise<string>`,
  `read(path)` giving a file of the candidate commit (`undefined` when
  missing): the site's own rule, e.g. the version from its `package.json`.
  What it returns must be `MAJOR.MINOR.PATCH`; else the release is refused
  with the reason.

Everything else about a release (Maintainer and above, the candidate is the
last green main pipeline, the commit the user saw, the tag must be newer than
production's, the description listing the commits) stays as it is.

## Settings (environment)

As the website's README today, unchanged names, so the website's `.env` keeps
working: `CONTENT_BOT_REPO_URL`, `CONTENT_BOT_GITLAB_TOKEN`, `GITLAB_URL`,
`CONTENT_BOT_URL`, `CONTENT_BOT_OAUTH_ID`, `CONTENT_BOT_OAUTH_SECRET`,
`CONTENT_BOT_GITLAB_PROJECT` (now required: no site is the default),
`CONTENT_BOT_MIN_ACCESS` (30), `CONTENT_BOT_MODEL` (`claude-opus-5-5`),
`CONTENT_BOT_SITE_DIR` (`/data/site`), `CONTENT_BOT_REPO_DIR`
(`/data/website` becomes `/data/repo`), `CONTENT_BOT_PORT` (8290),
`CLAUDE_EXECUTABLE` (`claude`). `CONTENT_BOT_TEST_URL`, `CONTENT_BOT_PROD_URL`,
`CONTENT_BOT_BUILD` and `CONTENT_BOT_CHECKS` go: they are the config's
`urls`, `build` and `checks` now; `serve` refuses to start when one of them is
still set, naming the config field it moved to.

## Tests

- The website's `tests/content-bot.test.mjs` moves to `tests/bot.test.mjs`
  and keeps every case (edits and the drawings' text, the claude call, the
  copies, a change from request to main, the guard, the checks, a push race,
  undo, the change list, the GitLab login, the release flow), importing from
  `dist/` as the template does; its seed repository gains a
  `content-bot.config.mjs` and the site-specific names become that config's.
- `tests/config.test.mjs`: the example loads; each required field missing, a
  wrong kind, a glob with `..`, an unknown field, a `version` that is neither a
  known name nor a function: refused with the field named; defaults filled.
- `tests/version.test.mjs`: the three policies against a seed repository
  (`aifactory` with and without a completed requirement, `patch` with and
  without a release, a function, a function returning something that is not a
  version).
- `tests/cli.test.mjs`: `--help`, `--version`, `init` into an empty directory
  (the four files, a second run keeps them), `check` with an empty environment
  (reports each missing variable, exits 1), `serve` with
  `CONTENT_BOT_TEST_URL` set (refuses, names `urls.test`).
- `pnpm test`, `pnpm typecheck`, `pnpm build` (with `pack:check`: `assets/`
  in the tarball, the bin answers `--version`) and `pnpm template:check` pass.

## README

The website's `tools/content-bot/README.md`, made general: what the bot does,
`init` → `.env` → OAuth application → claude login → `docker compose up`, the
config reference (every field, the three version policies), the environment
table, developing (`pnpm test`, running `serve` locally against a clone in
`CONTENT_BOT_REPO_DIR`). The website appears once, as the example config.

## Out of scope

- The website's own change (deleting its `tools/content-bot/`, adding its
  config, rebuilding its container from this package): a
  requirement of the website, after this package is published.
- GitHub as the repository platform; an API-key LLM provider; several sites in
  one bot.
- Publishing to npmjs: a person's `v0.1.0` tag, after the website runs it.

## Acceptance Criteria

- `src/` holds the bot as TypeScript (`auth`, `bot`, `claude`, `config`,
  `edits`, `gitlab`, `repo`, `server`, `site`, `svg`, `version`, `cli`,
  `index`), `assets/page.html` the page; `pnpm build` compiles with no
  runtime dependency, and `package.json` `files` ships `dist`, `assets`,
  `README.md`, `LICENSE`.
- Nothing under `src/`, `assets/` or `scripts/` names Bytecraft, `bc.int`,
  `bytecraft.com.tr`, `devops/website`, `site-content.ts` or an IP address
  (`grep -ri` finds none); the website's values appear only in `README.md`
  (the example) and `tests/`.
- `site-content-bot serve` reads `content-bot.config.mjs` from the clone's
  root (or `--config`), validates it as described (required fields, kinds,
  globs without `..`, unknown fields refused, version a known name or a
  function) and refuses to start on an invalid config, a missing required
  variable, or a removed variable (`CONTENT_BOT_TEST_URL`, `CONTENT_BOT_PROD_URL`,
  `CONTENT_BOT_BUILD`, `CONTENT_BOT_CHECKS`), naming the field or variable.
- The editable files, the prompt's "You may change only" list, the guard's
  refusals, the copies' exclusions, the build, the checks, the URLs and the
  page's brand strings all come from the config; an edit to a file outside
  `editable`, or to an SVG's markup, is refused as today.
- The three version policies behave as described, `aifactory` exactly as the
  website's `rqVersion` does today, and the release flow's other rules are
  unchanged.
- `site-content-bot check` reports each item and exits 1 on a failure;
  `site-content-bot init` writes the four files and keeps existing ones.
- The website's test suite runs here in full against `dist/` and passes, with
  the new config, version and CLI tests; `pnpm test`, `pnpm typecheck`,
  `pnpm build` (including `pack:check`) and `pnpm template:check` pass.
- `README.md` documents the config, the policies, the environment and the
  setup, with the website as its only example.
