// The command: --help, --version, init into an empty directory (the four files,
// a second run keeps them), check with an empty environment (reports each
// missing variable, exits 1), serve with a removed or renamed variable set
// (refuses, names the config field or the new name) and with a variable
// missing; the platform from CONTENT_BOT_PLATFORM or the repository host.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('init writes the config and the container files once, and keeps what is there', () => {
  const site = join(work, 'site');
  const first = cli(['init', '--dir', site]);
  assert.equal(first.status, 0, first.stderr);
  for (const file of ['content-bot.config.mjs', 'tools/content-bot/Dockerfile', 'tools/content-bot/compose.yaml', 'tools/content-bot/.env.example']) {
    assert.ok(existsSync(join(site, file)), file);
    assert.match(first.stdout, new RegExp(`written  ${file.replace(/[.]/g, '\\.')}`));
  }
  const dockerfile = readFileSync(join(site, 'tools/content-bot/Dockerfile'), 'utf8');
  assert.match(dockerfile, new RegExp(`site-content-bot@${version.replace(/[.]/g, '\\.')}`), 'the Dockerfile installs this version');
  assert.match(dockerfile, /@anthropic-ai\/claude-code@/);
  assert.match(dockerfile, /CMD \["site-content-bot", "serve"\]/);
  assert.doesNotMatch(dockerfile, /COPY/, 'nothing of the site is copied; the clone is made at run time');
  assert.match(readFileSync(join(site, 'tools/content-bot/compose.yaml'), 'utf8'), /env_file: \.env/);
  const example = readFileSync(join(site, 'tools/content-bot/.env.example'), 'utf8');
  for (const name of ['CONTENT_BOT_REPO_URL', 'CONTENT_BOT_PLATFORM', 'CONTENT_BOT_PLATFORM_URL', 'CONTENT_BOT_TOKEN', 'CONTENT_BOT_PROJECT', 'CONTENT_BOT_URL', 'CONTENT_BOT_OAUTH_ID', 'CONTENT_BOT_OAUTH_SECRET']) assert.match(example, new RegExp(`^${name}=$`, 'm'), name);
  assert.doesNotMatch(example, /CONTENT_BOT_TEST_URL|CONTENT_BOT_BUILD|CONTENT_BOT_CHECKS|GITLAB_URL|CONTENT_BOT_GITLAB_/, 'the removed and renamed variables are not offered');
  assert.match(readFileSync(join(site, 'content-bot.config.mjs'), 'utf8'), /deploy: \{ test: 'deploy_linux', production: 'deploy_release' \}/, 'the deploy jobs are in the example config');

  writeFileSync(join(site, 'content-bot.config.mjs'), 'export default { mine: true };\n');
  const second = cli(['init', '--dir', site]);
  assert.equal(second.status, 0);
  assert.equal(readFileSync(join(site, 'content-bot.config.mjs'), 'utf8'), 'export default { mine: true };\n', 'an existing file is left alone');
  assert.equal((second.stdout.match(/^kept     /gm) ?? []).length, 4);
  assert.doesNotMatch(second.stdout, /^written/m);
});

test('check with an empty environment reports each missing variable and exits 1; a removed variable is a failure that names its field, a renamed one its new name', () => {
  const result = cli(['check', '--config', join(work, 'none.mjs')], { ...bare, CONTENT_BOT_TEST_URL: 'https://x', GITLAB_URL: 'https://gitlab.example', CLAUDE_EXECUTABLE: join(work, 'no-claude') });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^ok   the platform is GitLab: from the repository host \(none\)$/m);
  for (const name of ['CONTENT_BOT_REPO_URL', 'CONTENT_BOT_TOKEN', 'CONTENT_BOT_URL', 'CONTENT_BOT_OAUTH_ID', 'CONTENT_BOT_OAUTH_SECRET', 'CONTENT_BOT_PROJECT', 'CONTENT_BOT_PLATFORM_URL']) assert.match(result.stdout, new RegExp(`^FAIL ${name} is set$`, 'm'), name);
  assert.match(result.stdout, /^FAIL CONTENT_BOT_TEST_URL is not set: it has moved to content-bot\.config\.mjs \(urls\.test\)$/m);
  assert.match(result.stdout, /^FAIL GITLAB_URL is not set: GITLAB_URL is now CONTENT_BOT_PLATFORM_URL$/m);
  assert.match(result.stdout, /^FAIL .*none\.mjs loads: .*none\.mjs does not exist$/m);
  assert.match(result.stdout, /^FAIL .*no-claude answers \(logged in\): claude could not be started/m);
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
