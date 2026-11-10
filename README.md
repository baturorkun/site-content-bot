# site-content-bot

A chat that reads a website's repository and changes its texts. A person logs
in with GitLab or GitHub, asks about the site or writes what should change, in Turkish,
English or any other language, and the bot answers in the language they wrote
in. A change is shown as old and new text side by side; **Apply** pushes it to
main as one commit authored by the person, and the site's own pipeline deploys
it to the test domain. **Recent changes** lists the bot's commits with where
each one is (pipeline, test site, production), **Undo** reverts the latest one
the same way, and **Release…** (Maintainers and Owners) ships what the test
site serves to production as a Release with a version the site's rule
fixes.

- **It reads, read-only:** a copy of main, the test site built from it the way
  CI builds it, and the sources of the latest Release (production). The
  copies are made once per commit or tag, under `CONTENT_BOT_SITE_DIR`.
- **It changes** only the files the site lists as editable: text files under a
  rule the site writes, and the text inside `<text>`/`<tspan>` of SVG
  drawings. File names, layout, code, styles and raster images are refused.
- Before a push it checks that only editable files changed, that a drawing's
  markup is untouched, and runs the site's checks; a failure pushes nothing.
- Each change is one commit on main, authored by the person who asked, with
  `Requested-by:` and `Content-bot:` trailers.
- The answers come from a language model CLI signed in inside the
  container: `claude` (the default, a Claude subscription) or `codex` (a
  ChatGPT login or an OpenAI key). It reads the copies only and writes
  nothing (below, *The language model*). Chats are kept in the browser.

The bot knows nothing about any one site. A site describes itself in
`content-bot.config.mjs` at the root of its repository; where the bot runs and
its secrets are in a `.env` on the host.

## Setting it up for a site

In a clone of the site's repository, on the host that will run the bot:

```
npx site-content-bot init
```

`init` is a wizard. It finds out what it can, proposes it (Enter takes the
proposal) and asks only for the rest:

1. **The platform**, first, since the rest follows it. From the clone's
   `origin`: `github.com` is GitHub, `gitlab.com` is GitLab, and a company's
   own server is asked without a token whether it is GitLab or GitHub
   Enterprise. Its address comes from the remote too (`https://gitlab.com`,
   `https://gitlab.company.com`, a GitHub Enterprise host; nothing for
   github.com), as do the repository URL and the project path.
2. **The container engine**: `docker compose`, else `podman compose`, else
   `podman-compose`; the first that answers is written to `.env` and used
   from then on.
3. **The site** (`content-bot.config.mjs`): the name from `package.json`, the
   build and the checks from the lockfile and its scripts, the build output
   from `.gitignore`, the content files (`src/content/*`, `src/i18n/**`,
   `locales/**`, `content/**`, SVGs under `public/`), the deploy jobs from
   `.gitlab-ci.yml` or `.github/workflows/`, the version policy (`aifactory`
   when `requirements/` exists, else `patch`); the test and production URLs
   are asked.
4. **The bot's address** (`CONTENT_BOT_URL`, proposed
   `http://<this host>:8290`); its port is the port the container publishes
   on the host. Without a port (a proxy in front) the host port is asked.
5. **The OAuth application**: the wizard prints the page to open and what to
   enter there (the callback URL included), then asks for its ID and secret.
   This is the one step on the platform's pages; there is no API for it.
6. **The token**, with where to make it and which rights it needs. It is
   checked at once: the project answers it, it may push (on GitLab its
   scopes, on GitHub `permissions.push`), git reaches the repository. A
   refusal says why and asks again.

It writes `content-bot.config.mjs` and `tools/content-bot/compose.yaml`
(commit these) and `tools/content-bot/.env` (mode `0600`, added to
`.gitignore`, never committed). The compose file runs the published image
(below, *Running it*); nothing is built on the host. Run again, it proposes
what it wrote and keeps the compose file.

Without a terminal: `init --yes` takes every proposal; what has none comes
from flags (`--test-url`, `--production-url`, `--url`, `--oauth-id`, and
`--platform`, `--project`, `--repo-url`, `--platform-url`, `--engine`,
`--container`, `--port`, `--min-access`, `--llm`, `--model` to override) and the secrets from the
environment (`CONTENT_BOT_TOKEN`, `CONTENT_BOT_OAUTH_SECRET`). A value with no
source stops it, naming the flag; so does a token the platform refuses.

Then start it:

```
npx site-content-bot start
```

## Running it

In the site's clone on the host, after `init` (each takes `--dir <path>`):

```
site-content-bot start                    up, healthy, checked; logs the model CLI in; prints the address
site-content-bot stop                     down; the volume (clone, copies, logins) is kept
site-content-bot logs [--follow]          the container's log
site-content-bot status                   whether it runs, and its check
site-content-bot update [--to <version>]  the image to <version> (default: this CLI's), pulled and started
site-content-bot login                    the model CLI's login again, when it expired
```

They use the engine `init` found (`CONTENT_BOT_ENGINE`: `docker`, `podman` or
`podman-compose`) and print each command before they run it. `start` waits
for the container's health check, then runs `site-content-bot check` in it:
the platform, the language model, each variable, the repository, the config,
the platform's API and the model CLI's login. When only the login is missing
and you are at a terminal, it opens it (`claude` then `/login`, or `codex
login --device-auth`) and checks again; without a terminal it prints the
command and exits 1. `npx site-content-bot@latest update` moves a site to the
newest bot.

**The image** is `ghcr.io/baturorkun/site-content-bot:<version>` (and
`:latest`), for amd64 and arm64: Node 20, git, pnpm and yarn, both model CLIs
at fixed versions, and this package. Every release publishes one
(`.github/workflows/image.yml`, from the tagged code). The first one creates
the package on GitHub, where its owner makes it public once (the package's
settings, *Change visibility*). A site that needs more for its build or
checks (Python, a browser) builds its own image `FROM` this one and names it
in `CONTENT_BOT_IMAGE` in `.env`.

**This host's own settings** go in `tools/content-bot/compose.override.yaml`
beside `compose.yaml`: what only this host needs, never committed (`init` puts it
in `.gitignore` with `.env`). Every command passes it to compose when it is
there. For example, a name containers on this host do not resolve:

```yaml
services:
  content-bot:
    extra_hosts:
      - "gitlab.example.internal:10.0.0.5"
```

**Two sites on one host**: give each its own `CONTENT_BOT_CONTAINER` (the
container's name and its compose project, so its own volume) and its own host
port; `init` asks both.

## The language model

`CONTENT_BOT_LLM` chooses the CLI that answers; the container has both, so
switching is a change in `.env` and a restart.

| | `claude` (default) | `codex` |
|---|---|---|
| Login | a Claude subscription: `claude`, then `/login` | a ChatGPT login: `codex login --device-auth` (or an OpenAI key: `codex login --with-api-key`) |
| Model | `CONTENT_BOT_MODEL`, default `claude-opus-5-5` | `CONTENT_BOT_MODEL`, default codex's own |
| Reads the copies with | `Read`, `Glob`, `Grep` only; every other tool denied | read-only shell commands in a read-only sandbox, no approvals, no network |
| Runs in | a throwaway directory, so no project `CLAUDE.md` is read | a throwaway directory, so no project `AGENTS.md` is read; user config ignored |

Both answer the same JSON schema; the edit rules, the guard and everything
after are the same. The logins live in the `/data` volume (`HOME`).

**The login** is the platform's (so the company's login): **Log in with
GitLab** or **Log in with GitHub** goes there and back. A member of the project
(`CONTENT_BOT_PROJECT`) with Developer access or above on GitLab, the write
role or above on GitHub (`CONTENT_BOT_MIN_ACCESS`) comes in; their name and
e-mail there become the author of the commits they ask for. Who may use the
bot is decided by the project's members on the platform; the bot keeps no
passwords.

## The platform: GitLab or GitHub

The bot runs against one platform, chosen by `CONTENT_BOT_PLATFORM` (`gitlab`
or `github`) or, when that is empty, by the host of `CONTENT_BOT_REPO_URL`
(`github.com`, or a host starting with `github.`, means GitHub). It gives the
login, where a commit is on its way (a GitLab pipeline, a GitHub Actions run,
and the deploy job named in the config's `deploy`), the latest Release (what
production serves) and the Release the bot makes. Everything else is git.

### On GitHub

- **Login**: the OAuth App above; the bot asks for `read:user user:email` and
  takes the primary verified e-mail. A collaborator's role on the repository
  decides their access, on the same scale as GitLab's levels so
  `CONTENT_BOT_MIN_ACCESS` means the same: `read` and `triage` 20 (they
  cannot push, so they do not come in by default), `write` 30 (edits),
  `maintain` 40 (releases too), `admin` 50.
- **Token** (`CONTENT_BOT_TOKEN`): a fine-grained personal access token on the
  repository with *Contents* read and write (the pushes, the releases),
  *Actions* read (the run states) and *Metadata* read (the collaborators'
  roles), or a classic token with `repo`. When a ruleset protects `v*` tags,
  the token's owner must be allowed to bypass it, or **Release…** is refused
  with GitHub's message.
- **Deploy jobs**: `deploy.test` and `deploy.production` in the config are
  the names of the Actions jobs (the `name:` of a job, or its key) that put
  main on the test domain and a release tag on production. **Recent changes**
  looks at the newest run of each commit; a release candidate is the newest
  successful run on `main` that has the test job, so a green lint workflow
  on a commit whose deploy failed does not count.
- **GitHub Enterprise**: `CONTENT_BOT_PLATFORM_URL=https://github.company.com`;
  the API is then `<it>/api/v3`. For github.com, leave it empty.

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
  deploy: { test: 'deploy_linux', production: 'deploy_release' },
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
| `deploy` | optional | The deploy jobs of the site's pipeline: `test` puts main on the test domain, `production` a release tag on production (GitLab job names, GitHub Actions job names). Default `deploy_linux` and `deploy_release`. |

### Version policies

What **Release…** offers as the next version, fixed, not chosen:

- `aifactory`: `1.<N>.<run>`, N the highest completed requirement under
  `requirements/` at the candidate commit, run the largest `retries` in that
  requirement's `completedRunId` manifest (the attempt counter), `1.0.0` with
  none. Once that requirement has a release tag, the tag at a commit is its
  version, and a later commit without a new requirement takes the newest such
  tag's last number + 1. The sidebar shows the requirement versions of main
  and production.
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

In `tools/content-bot/.env` on the host, never in the repository; `init` writes it:

| Variable | |
|---|---|
| `CONTENT_BOT_REPO_URL` | the repository over HTTP, e.g. `https://gitlab.example.com/group/site.git` or `https://github.com/owner/site.git` |
| `CONTENT_BOT_PLATFORM` | `gitlab` or `github`; empty: from the repository's host |
| `CONTENT_BOT_PLATFORM_URL` | the platform: the GitLab instance (required there); GitHub, default `https://github.com` (set it for GitHub Enterprise) |
| `CONTENT_BOT_PROJECT` | the project: `group/site` on GitLab, `owner/repo` on GitHub |
| `CONTENT_BOT_TOKEN` | the bot's token (GitLab: a project access token, Maintainer, `write_repository`, `read_api`, `api`; GitHub: above); git gets it through `GIT_ASKPASS`, never through the URL |
| `CONTENT_BOT_URL` | the bot as the browser reaches it; the platform sends the login back to `<it>/auth/callback` |
| `CONTENT_BOT_OAUTH_ID`, `CONTENT_BOT_OAUTH_SECRET` | the OAuth application |
| `CONTENT_BOT_MIN_ACCESS` | the access a person needs, default `30` (Developer on GitLab, the write role on GitHub) |
| `CONTENT_BOT_LLM` | `claude` (default) or `codex` |
| `CONTENT_BOT_MODEL` | the chosen CLI's model; default `claude-opus-5-5` for claude, codex's own for codex |
| `CONTENT_BOT_ENGINE` | the container engine: `docker`, `podman` or `podman-compose` (`init` writes it) |
| `CONTENT_BOT_HOST_PORT` | the host port the compose file publishes, default `8290` |
| `CONTENT_BOT_CONTAINER` | the container's name and compose project, default `site-content-bot` |
| `CONTENT_BOT_IMAGE` | another image (one built `FROM` the published one); default the compose file's |
| `CONTENT_BOT_PORT` | the port the bot listens on inside the container, default `8290` |
| `CONTENT_BOT_REPO_DIR` | the clone, default `/data/repo` |
| `CONTENT_BOT_SITE_DIR` | the copies, default `/data/site` |
| `CLAUDE_EXECUTABLE`, `CODEX_EXECUTABLE` | default `claude`, `codex` |

The test and production URLs, the build and the checks are the config's
`urls`, `build` and `checks`; `serve` refuses to start while
`CONTENT_BOT_TEST_URL`, `CONTENT_BOT_PROD_URL`, `CONTENT_BOT_BUILD` or
`CONTENT_BOT_CHECKS` is still set, naming the field each moved to. The GitLab
names of the first version, `CONTENT_BOT_GITLAB_TOKEN`, `GITLAB_URL` and
`CONTENT_BOT_GITLAB_PROJECT`, are refused the same way, naming the new name.

The container's `/data` volume holds the clone, the copies the model reads and
the model CLIs' logins (`HOME`). The pipeline states come from the platform, by the
jobs named in the config's `deploy`.

## The command

```
site-content-bot serve [--config <file>]   the bot itself (what the container runs)
site-content-bot check [--config <file>]   report whether everything is in place; exit 1 if not
site-content-bot init  [--dir <path>]      the wizard: set the bot up for the site (--yes without questions)
site-content-bot start|stop|logs|status|update|login   the container (Running it, above)
```

`--config` names a config file instead of the one at the clone's root (for a
local run). As a library, `import { createApp, ContentBot, Repo, Site,
createPlatform, gitlabPlatform, githubPlatform, askClaude, askCodex, loadConfig } from
'site-content-bot'` gives the parts.

## Publishing

For the maintainer. A pushed tag `v<version>` (the `package.json` version)
runs two workflows: `publish.yml` publishes the package to npmjs and
`image.yml` the image to GHCR.

- npm needs the repository secret `NPM_TOKEN` (a granular token allowed to
  publish this package name), until trusted publishing is set up for it on
  npmjs.com.
- The first publish of a new name is staged: npmjs.com, *Staged Packages*,
  *Approve* (with 2FA). A `0.0.0-stage` placeholder appears meanwhile.
- The first image creates the GHCR package private; make it public once in
  its settings (*Change visibility*), or the sites cannot pull it.

```
git tag v0.5.0 && git push origin v0.5.0
```

## Developing

`pnpm test` builds and runs the tests against `dist/`, with a fake claude, a fake codex, a
fake GitLab, a fake GitHub and a bare repository as origin. Locally, with the variables above
and a clone directory in `CONTENT_BOT_REPO_DIR`:

```
node dist/cli.js serve --config path/to/content-bot.config.mjs
```
