# site-content-bot

A chat that reads a website's repository and changes its texts. A person logs
in with GitLab, asks about the site or writes what should change, in Turkish,
English or any other language, and the bot answers in the language they wrote
in. A change is shown as old and new text side by side; **Apply** pushes it to
main as one commit authored by the person, and the site's own pipeline deploys
it to the test domain. **Recent changes** lists the bot's commits with where
each one is (pipeline, test site, production), **Undo** reverts the latest one
the same way, and **Release…** (Maintainers and Owners) ships what the test
site serves to production as a GitLab Release with a version the site's rule
fixes.

- **It reads, read-only:** a copy of main, the test site built from it the way
  CI builds it, and the sources of the latest GitLab Release (production). The
  copies are made once per commit or tag, under `CONTENT_BOT_SITE_DIR`.
- **It changes** only the files the site lists as editable: text files under a
  rule the site writes, and the text inside `<text>`/`<tspan>` of SVG
  drawings. File names, layout, code, styles and raster images are refused.
- Before a push it checks that only editable files changed, that a drawing's
  markup is untouched, and runs the site's checks; a failure pushes nothing.
- Each change is one commit on main, authored by the person who asked, with
  `Requested-by:` and `Content-bot:` trailers.
- The answers come from the `claude` CLI under a signed-in subscription (no
  API key). It may use `Read`, `Glob` and `Grep` in the copies only; every
  other tool is denied. Chats are kept in the browser.

The bot knows nothing about any one site. A site describes itself in
`content-bot.config.mjs` at the root of its repository; where the bot runs and
its secrets are in a `.env` on the host.

## Setting it up for a site

In the site's repository:

```
npx site-content-bot init
```

writes `content-bot.config.mjs` (every field, with comments) and
`tools/content-bot/{Dockerfile,compose.yaml,.env.example}`; a file that exists
is kept. Edit the config (below) and commit it. Then, on the host that runs
the bot:

1. `tools/content-bot/.env` from `.env.example` (the variables below). Git
   ignores `.env`; it never enters the repository.
2. The GitLab OAuth application, once (a group's or the instance's Settings >
   Applications): name `Content Bot`, redirect URI
   `<CONTENT_BOT_URL>/auth/callback`, confidential, scope `read_user`. Its
   Application ID and Secret go into `.env`.
3. A project access token of the site's project, role Maintainer, scopes
   `write_repository`, `read_api` and `api` (the releases), into `.env`.
4. `docker compose -f tools/content-bot/compose.yaml up -d --build`
5. The claude login, once (and again when the session expires: the bot then
   answers "Claude is not logged in in the container"):

   ```
   docker exec -it site-content-bot claude
   ```

   then `/login` in it, and leave with `/exit`.

`site-content-bot check` in the container reports whether everything is in
place: each variable, the repository, the config, GitLab's API, the claude
login.

**The login** is GitLab's (so the company's login): **Log in with GitLab**
goes to GitLab and back. A member of the project (`CONTENT_BOT_GITLAB_PROJECT`)
with Developer access or above (`CONTENT_BOT_MIN_ACCESS`) comes in; their
GitLab name and e-mail become the author of the commits they ask for. Who may
use the bot is decided by the project's members on GitLab; the bot keeps no
passwords.

## The config: `content-bot.config.mjs`

An ES module at the repository's root, default export an object. It is read
once, after the clone is made or synced, when the bot starts; a change takes
effect on restart. An unknown field, a missing required one or a wrong value
stops the start, naming the field.

The Bytecraft website's, the first site to run the bot:

```js
export default {
  brand: { mark: 'BC', name: 'Bytecraft website', title: 'Content Bot', subtitle: "The Bytecraft website's texts" },
  editable: [
    { path: 'src/content/site-content.ts', kind: 'text',
      rule: 'the text inside string literals (content.tr is Turkish, content.en English); never keys, types, imports, paths, functions or the structure of the file; keep the TypeScript valid (escape quotes as the file does)' },
    { glob: 'public/**/*.svg', kind: 'svg-text' },
  ],
  layout: 'layout, code and styles: src/, public/index.html',
  exclude: ['runs', 'handoffs', '.factory'],
  build: {
    command: 'pnpm --dir "$CLONE" install --frozen-lockfile --prefer-offline >/dev/null && ln -s "$CLONE/node_modules" node_modules && node node_modules/typescript/bin/tsc --project tsconfig.build.json && sh scripts/release.sh >/dev/null',
    output: 'release/site',
    describe: 'index.html (English), tr/index.html (Turkish), public/, dist/',
  },
  checks: 'pnpm install --frozen-lockfile --prefer-offline >/dev/null && node node_modules/typescript/bin/tsc --noEmit && node --test tests/prerender.test.mjs',
  version: 'aifactory',
  urls: { test: 'https://test.bytecraft.com.tr', production: 'https://bytecraft.com.tr' },
};
```

| Field | | |
|---|---|---|
| `brand` | required | `name` (the site, as the page and the model call it); `mark` (the sidebar's mark, default the name's initials), `title` (the bot's name, default `Content Bot`), `subtitle` (default "The *name*'s texts"). |
| `editable` | required, non-empty | What may change. Each entry: `path` (one file) or `glob` (`*` within a segment, `**` across segments, no `..`); `kind` `text` (any text in the file, under `rule`, which goes to the model word for word) or `svg-text` (the text inside `<text>`/`<tspan>` only, markup untouched; its rule is fixed). The guard refuses everything else. |
| `layout` | optional | One line for the model: where the rest of the site is, for questions. |
| `exclude` | optional | Directories left out of the copies the model reads. Default `runs`, `handoffs`, `.factory`. |
| `build` | required | `command`: turns a copy of main into what the test domain serves, run in that copy with `CLONE` set to the bot's clone (whose `node_modules` it may use); `output`: the directory it leaves; `describe` (optional): what is in it, for the model. |
| `checks` | required | The site's checks, run in the clone before a push. A failure pushes nothing. |
| `version` | optional | The next release's version: `aifactory` (default), `patch`, or a function (below). |
| `urls` | required | `test` and `production`: what the test domain and production serve. |

### Version policies

What **Release…** offers as the next version, fixed, not chosen:

- `aifactory`: `1.<N>.<run>`, N the highest completed requirement under
  `requirements/` at the candidate commit, run the largest `retries` in that
  requirement's `completedRunId` manifest (the attempt counter), `1.0.0` with
  none. The sidebar shows the requirement versions of main and production.
  When production already runs that version, there is nothing to release
  until the next requirement is completed.
- `patch`: production's tag with the patch number raised (`v1.0.0` with no
  release). Anything on main since the release is a new version.
- A function `({ candidate, production, read }) => 'MAJOR.MINOR.PATCH'`:
  `candidate` the commit that would ship, `production` `{ tag, commit }` or
  `null`, `read(path)` a file of the candidate commit (`undefined` when
  missing). For example the version from the site's `package.json`:
  `async ({ read }) => JSON.parse(await read('package.json')).version`.
  Anything that is not `MAJOR.MINOR.PATCH` refuses the release, naming it.

Whatever the policy: only a Maintainer or Owner releases, the candidate is the
newest main commit whose pipeline passed (the test site serves it), the release
is made at the commit the person saw, its tag must be newer than production's,
and its description lists the commits since production.

## Settings (environment)

In `tools/content-bot/.env` on the host, never in the repository:

| Variable | |
|---|---|
| `CONTENT_BOT_REPO_URL` | the repository over HTTP, e.g. `https://gitlab.example.com/group/site.git` |
| `CONTENT_BOT_GITLAB_TOKEN` | the project access token (Maintainer; `write_repository`, `read_api`, `api`); git gets it through `GIT_ASKPASS`, never through the URL |
| `GITLAB_URL` | GitLab: the login, the pipeline status, the releases |
| `CONTENT_BOT_GITLAB_PROJECT` | the project, e.g. `group/site` |
| `CONTENT_BOT_URL` | the bot as the browser reaches it; GitLab sends the login back to `<it>/auth/callback` |
| `CONTENT_BOT_OAUTH_ID`, `CONTENT_BOT_OAUTH_SECRET` | the GitLab OAuth application |
| `CONTENT_BOT_MIN_ACCESS` | the project access level a person needs, default `30` (Developer) |
| `CONTENT_BOT_MODEL` | default `claude-opus-5-5` |
| `CONTENT_BOT_PORT` | default `8290` |
| `CONTENT_BOT_REPO_DIR` | the clone, default `/data/repo` |
| `CONTENT_BOT_SITE_DIR` | the copies, default `/data/site` |
| `CLAUDE_EXECUTABLE` | default `claude` |

The test and production URLs, the build and the checks are the config's
`urls`, `build` and `checks`; `serve` refuses to start while
`CONTENT_BOT_TEST_URL`, `CONTENT_BOT_PROD_URL`, `CONTENT_BOT_BUILD` or
`CONTENT_BOT_CHECKS` is still set, naming the field each moved to.

The container's `/data` volume holds the clone, the copies the model reads and
the claude login (`HOME`). The pipeline states come from GitLab: the job
`deploy_linux` on main is the test domain's deploy, `deploy_release` on a
release tag production's.

## The command

```
site-content-bot serve [--config <file>]   start the bot
site-content-bot check [--config <file>]   report whether everything is in place; exit 1 if not
site-content-bot init  [--dir <path>]      write what a site needs
```

`--config` names a config file instead of the one at the clone's root (for a
local run). As a library, `import { createApp, ContentBot, Repo, Site,
GitLabAuth, askClaude, loadConfig } from 'site-content-bot'` gives the parts.

## Developing

`pnpm test` builds and runs the tests against `dist/`, with a fake claude, a
fake GitLab and a bare repository as origin. Locally, with the variables above
and a clone directory in `CONTENT_BOT_REPO_DIR`:

```
node dist/cli.js serve --config path/to/content-bot.config.mjs
```
