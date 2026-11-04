// The published image: docker/Dockerfile (both CLIs at fixed versions, the
// packed tarball, the volume, the health check, the labels) and
// .github/workflows/image.yml (v* tags, the tag against package.json, both
// platforms, a push only on a tag); docker/ is not in the npm package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync('docker/Dockerfile', 'utf8');
const workflow = readFileSync('.github/workflows/image.yml', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('the Dockerfile: both CLIs at fixed versions and the packed tarball; git; the volume, the user, the health check, serve; the labels', () => {
  assert.match(dockerfile, /^FROM node:20-bookworm-slim$/m);
  assert.match(dockerfile, /npm install --global @anthropic-ai\/claude-code@\d+\.\d+\.\d+ @openai\/codex@\d+\.\d+\.\d+ \/tmp\/site-content-bot\.tgz/);
  assert.match(dockerfile, /^COPY \$\{TARBALL\} \/tmp\/site-content-bot\.tgz$/m, 'the tagged code, not npm');
  assert.match(dockerfile, /git ca-certificates/);
  assert.match(dockerfile, /corepack prepare pnpm@\d+\.\d+\.\d+ --activate/);
  assert.match(dockerfile, /^VOLUME \/data$/m);
  assert.match(dockerfile, /HOME=\/data\/home/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK .*\/healthz/m);
  assert.match(dockerfile, /^CMD \["site-content-bot", "serve"\]$/m);
  assert.match(dockerfile, /org\.opencontainers\.image\.source="https:\/\/github\.com\/baturorkun\/site-content-bot"/);
  assert.match(dockerfile, /org\.opencontainers\.image\.version="\$\{VERSION\}"/);
});

test('the workflow: on v* tags and by hand, the tag is the package.json version, packed, both platforms, pushed to GHCR only with a tag', () => {
  assert.match(workflow, /on:\n  push:\n    tags: \['v\*'\]\n  workflow_dispatch:/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /if \[ -n "\$TAG" \] && \[ "\$TAG" != "v\$version" \]/);
  assert.match(workflow, /npm pack --silent/);
  assert.match(workflow, /file: docker\/Dockerfile/);
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(workflow, /push: \$\{\{ env\.TAG != '' \}\}/);
  assert.match(workflow, /Log in to GHCR\n\s+if: env\.TAG != ''/);
  assert.match(workflow, /image=ghcr\.io\/\$owner\/site-content-bot/);
  assert.match(workflow, /:\$\{\{ steps\.version\.outputs\.version \}\}\n\s+\$\{\{ steps\.version\.outputs\.image \}\}:latest/);
});

test('docker/ is not published to npm', () => {
  assert.ok(!pkg.files.some((entry) => entry.startsWith('docker')), 'files');
});
