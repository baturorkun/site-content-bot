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
