// The command: --help, --version, init without a terminal (refused, or --yes
// with the flags, the token verified before anything is written), check with an empty environment (reports each
// missing variable, exits 1), serve with a removed or renamed variable set
// (refuses, names the config field or the new name) and with a variable
// missing; the platform from CONTENT_BOT_PLATFORM or the repository host.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const work = mkdtempSync(join(tmpdir(), 'content-bot-cli-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

// A bare environment: PATH alone, so no CONTENT_BOT_* of the machine leaks in.
const bare = { PATH: process.env.PATH, HOME: work };
const cli = (args, env = bare) => spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', env, timeout: 60_000 });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

test('--version prints the package version', () => {
  const result = cli(['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), version);
});

test('--help exits 0; no command, an unknown command and an unknown option exit 2', () => {
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /serve \[--config <file>\]/);
  assert.match(help.stdout, /check \[--config <file>\]/);
  assert.match(help.stdout, /init \[--dir <path>\]/);
  assert.equal(cli([]).status, 2);
  assert.equal(cli(['dance']).status, 2);
  assert.equal(cli(['--no-such-option']).status, 2);
});

test('init: without a terminal and without --yes it refuses; --yes names a missing flag; a token the platform refuses stops it before anything is written', () => {
  const site = join(work, 'site');
  mkdirSync(join(site, 'src/content'), { recursive: true });
  execFileSync('git', ['init', '-q', '--initial-branch=main', site]);
  execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.invalid/group/site.git'], { cwd: site });
  writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'site', scripts: { build: 'make' } }));
  writeFileSync(join(site, 'src/content/texts.json'), '{}');

  const asked = cli(['init', '--dir', site]);
  assert.equal(asked.status, 2);
  assert.match(asked.stderr, /init asks questions; run it in a terminal, or pass --yes with the flags/);

  const missing = cli(['init', '--dir', site, '--yes', '--test-url', 'https://test.example']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--yes needs --production-url/);

  const flags = ['--test-url', 'https://test.example', '--production-url', 'https://example.com', '--oauth-id', 'app', '--url', 'http://bot.example:8290'];
  const refused = cli(['init', '--dir', site, '--yes', ...flags], { ...bare, CONTENT_BOT_OAUTH_SECRET: 's', CONTENT_BOT_TOKEN: 'glpat-x' });
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /the token was refused: /);
  for (const file of ['content-bot.config.mjs', 'tools/content-bot/.env', 'tools/content-bot/Dockerfile']) assert.ok(!existsSync(join(site, file)), `${file} is not written`);
  assert.doesNotMatch(refused.stdout + refused.stderr, /glpat-x/, 'the token is never printed');

  const help = cli(['--help']);
  for (const flag of ['--yes', '--platform', '--platform-url', '--token', '--oauth-secret', '--port', '--llm']) assert.match(help.stdout, new RegExp(flag.replace(/-/g, '\\-')), flag);
});

test('the init templates: the Dockerfile installs this version and copies nothing, compose publishes CONTENT_BOT_HOST_PORT', () => {
  const dockerfile = readFileSync('assets/init/Dockerfile', 'utf8');
  assert.match(dockerfile, /site-content-bot@\{\{version\}\}/);
  assert.match(dockerfile, /@anthropic-ai\/claude-code@\d+\.\d+\.\d+ @openai\/codex@\d+\.\d+\.\d+ /, 'both CLIs, at fixed versions');
  assert.match(dockerfile, /CMD \["site-content-bot", "serve"\]/);
  assert.doesNotMatch(dockerfile, /COPY/, 'nothing of the site is copied; the clone is made at run time');
  const compose = readFileSync('assets/init/compose.yaml', 'utf8');
  assert.match(compose, /env_file: \.env/);
  assert.match(compose, /"\$\{CONTENT_BOT_HOST_PORT:-8290\}:8290"/);
  assert.ok(!existsSync('assets/init/env.example'), 'the wizard writes .env; there is no example to copy');
  assert.match(readFileSync('assets/init/content-bot.config.mjs', 'utf8'), /deploy: \{ test: 'deploy_linux', production: 'deploy_release' \}/);
});

test('check with an empty environment reports each missing variable and exits 1; a removed variable is a failure that names its field, a renamed one its new name', () => {
  const result = cli(['check', '--config', join(work, 'none.mjs')], { ...bare, CONTENT_BOT_TEST_URL: 'https://x', GITLAB_URL: 'https://gitlab.example', CLAUDE_EXECUTABLE: join(work, 'no-claude') });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^ok   the platform is GitLab: from the repository host \(none\)$/m);
  for (const name of ['CONTENT_BOT_REPO_URL', 'CONTENT_BOT_TOKEN', 'CONTENT_BOT_URL', 'CONTENT_BOT_OAUTH_ID', 'CONTENT_BOT_OAUTH_SECRET', 'CONTENT_BOT_PROJECT', 'CONTENT_BOT_PLATFORM_URL']) assert.match(result.stdout, new RegExp(`^FAIL ${name} is set$`, 'm'), name);
  assert.match(result.stdout, /^FAIL CONTENT_BOT_TEST_URL is not set: it has moved to content-bot\.config\.mjs \(urls\.test\)$/m);
  assert.match(result.stdout, /^FAIL GITLAB_URL is not set: GITLAB_URL is now CONTENT_BOT_PLATFORM_URL$/m);
  assert.match(result.stdout, /^FAIL .*none\.mjs loads: .*none\.mjs does not exist$/m);
  assert.match(result.stdout, /^FAIL .*no-claude answers \(the claude CLI, logged in\): claude could not be started/m);
  assert.match(result.stdout, /^ok   the language model is claude: claude-cli \(subscription\), model claude-opus-5-5; CONTENT_BOT_LLM is empty, so claude$/m);
});

test('check reports a config that loads, with its editable files and version rule', () => {
  const config = join(work, 'ok.mjs');
  writeFileSync(config, `export default {
  brand: { name: 'Example site' },
  editable: [{ path: 'texts.json', kind: 'text' }, { glob: 'img/**/*.svg', kind: 'svg-text' }],
  build: { command: 'true', output: 'out' }, checks: 'true', version: 'patch',
  urls: { test: 'https://test.example', production: 'https://example.com' },
};
`);
  const result = cli(['check', '--config', config], { ...bare, CLAUDE_EXECUTABLE: join(work, 'no-claude') });
  assert.equal(result.status, 1, 'the variables are still missing');
  assert.match(result.stdout, /^ok   .*ok\.mjs loads: Example site; only texts\.json and the text of the drawings matching img\/\*\*\/\*\.svg may change; version: production's version with the patch number raised$/m);
});

test('serve refuses to start on a removed variable, naming the field, on a renamed one, naming the new name, and on a missing one', () => {
  const removed = cli(['serve'], { ...bare, CONTENT_BOT_BUILD: 'make', CONTENT_BOT_PROD_URL: 'https://x' });
  assert.equal(removed.status, 2);
  assert.match(removed.stderr, /CONTENT_BOT_PROD_URL has moved to content-bot\.config\.mjs \(urls\.production\); CONTENT_BOT_BUILD has moved to content-bot\.config\.mjs \(build\.command\); unset them\./);
  const renamed = cli(['serve'], { ...bare, CONTENT_BOT_GITLAB_TOKEN: 'x', CONTENT_BOT_GITLAB_PROJECT: 'g/s' });
  assert.equal(renamed.status, 2);
  assert.match(renamed.stderr, /CONTENT_BOT_GITLAB_TOKEN is now CONTENT_BOT_TOKEN; CONTENT_BOT_GITLAB_PROJECT is now CONTENT_BOT_PROJECT; rename them\./);
  const missing = cli(['serve'], { ...bare, CONTENT_BOT_REPO_URL: 'http://x/y.git' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /CONTENT_BOT_TOKEN, CONTENT_BOT_URL, CONTENT_BOT_OAUTH_ID, CONTENT_BOT_OAUTH_SECRET, CONTENT_BOT_PROJECT, CONTENT_BOT_PLATFORM_URL are empty \(see README\.md\)\./, 'on GitLab the platform URL is required');
  const github = cli(['serve'], { ...bare, CONTENT_BOT_REPO_URL: 'https://github.com/owner/site.git' });
  assert.equal(github.status, 2);
  assert.match(github.stderr, /CONTENT_BOT_TOKEN, CONTENT_BOT_URL, CONTENT_BOT_OAUTH_ID, CONTENT_BOT_OAUTH_SECRET, CONTENT_BOT_PROJECT are empty/, 'on GitHub the platform URL has a default');
  const wrong = cli(['serve'], { ...bare, CONTENT_BOT_PLATFORM: 'bitbucket' });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /CONTENT_BOT_PLATFORM is "bitbucket"; it is one of gitlab, github/);
});

test('the language model: codex is probed through its executable with its own default model; an unknown one is refused by serve and check', () => {
  const codex = join(work, 'fake-codex');
  // A codex that writes the answer to --output-last-message and records its arguments.
  writeFileSync(codex, `#!/bin/sh\ncat > /dev/null\nprintf "%s\\n" "$@" > "${join(work, 'codex-args.txt')}"\nwhile [ $# -gt 0 ]; do if [ "$1" = --output-last-message ]; then printf '{"ok":true}' > "$2"; fi; shift; done\n`);
  chmodSync(codex, 0o755);
  const result = cli(['check', '--config', join(work, 'none.mjs')], { ...bare, CONTENT_BOT_LLM: 'codex', CODEX_EXECUTABLE: codex });
  assert.match(result.stdout, /^ok   the language model is codex: codex-cli, model \(its default\)$/m);
  assert.match(result.stdout, new RegExp(`^ok   ${codex.replace(/[.]/g, '\\.')} answers \\(the codex CLI, logged in\\): model \\(its default\\)$`, 'm'));
  const args = readFileSync(join(work, 'codex-args.txt'), 'utf8').split('\n');
  assert.deepEqual(args.slice(0, 2), ['--sandbox', 'read-only']);
  assert.ok(!args.includes('--model'), 'no model: codex chooses');
  const wrong = cli(['check'], { ...bare, CONTENT_BOT_LLM: 'gemini' });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /^FAIL the language model is known: CONTENT_BOT_LLM is "gemini"; it is one of claude, codex$/m);
  const serve = cli(['serve'], { ...bare, CONTENT_BOT_LLM: 'gemini' });
  assert.equal(serve.status, 1);
  assert.match(serve.stderr, /CONTENT_BOT_LLM is "gemini"; it is one of claude, codex/);
});

test('check names the platform: from CONTENT_BOT_PLATFORM, or from the repository host, with the GitHub default URL', () => {
  const noClaude = { CLAUDE_EXECUTABLE: join(work, 'no-claude') };
  const named = cli(['check', '--config', join(work, 'none.mjs')], { ...bare, ...noClaude, CONTENT_BOT_PLATFORM: 'github', CONTENT_BOT_REPO_URL: 'https://gitlab.example/g/s.git' });
  assert.match(named.stdout, /^ok   the platform is GitHub: from CONTENT_BOT_PLATFORM; CONTENT_BOT_PLATFORM_URL defaults to https:\/\/github\.com$/m);
  assert.doesNotMatch(named.stdout, /CONTENT_BOT_PLATFORM_URL is set/);
  const byHost = cli(['check', '--config', join(work, 'none.mjs')], { ...bare, ...noClaude, CONTENT_BOT_REPO_URL: 'https://github.example.com/o/r.git', CONTENT_BOT_PLATFORM_URL: 'https://github.example.com' });
  assert.match(byHost.stdout, /^ok   the platform is GitHub: from the repository host github\.example\.com$/m);
  const gitlab = cli(['check', '--config', join(work, 'none.mjs')], { ...bare, ...noClaude, CONTENT_BOT_REPO_URL: 'https://gitlab.example/g/s.git' });
  assert.match(gitlab.stdout, /^ok   the platform is GitLab: from the repository host gitlab\.example$/m);
  assert.match(gitlab.stdout, /^FAIL CONTENT_BOT_PLATFORM_URL is set$/m);
  const wrong = cli(['check'], { ...bare, ...noClaude, CONTENT_BOT_PLATFORM: 'gitea' });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /^FAIL the platform is known: CONTENT_BOT_PLATFORM is "gitea"; it is one of gitlab, github$/m);
});
