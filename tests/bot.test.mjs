// The bot (moved from the website's tests/content-bot.test.mjs): edits and the
// drawings' text, the claude call, the copies Claude reads, a change from
// request to main, the guard, the checks, a push race, undo, the change list,
// the GitLab login, the server and the release flow. The origin is a bare
// repository here, claude a fake, the build and the site's checks shell
// commands; the site describes itself in the seed's content-bot.config.mjs.
// Run: node --test tests/bot.test.mjs (after pnpm build)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALLOWED_TOOLS, ContentBot, Editable, GitLabAuth, NOT_LOGGED_IN, PAGE_FILE, Repo, Site,
  applyEdits, applyFileEdits, askClaude, createApp, loadConfig, onlyTextChanged,
} from '../dist/index.js';

const work = mkdtempSync(join(tmpdir(), 'content-bot-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Seed', '-c', 'user.email=seed@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
const CONTENT_FILE = 'src/content/site-content.ts';
const CONTENT = `export const content = {\n  tr: { hero: 'Cihazdan buluta.', about: 'Hakkımızda metni.' },\n  en: { hero: 'From device to cloud.', about: 'About text.' },\n};\n`;
const DRAWING_FILE = 'public/assets/web/models.svg';
const DRAWING = '<svg viewBox="0 0 10 10"><text class="s" x="40" y="48">09 / SIMICS MODEL</text><text x="1"><tspan>A</tspan> board</text><rect class="p" width="260"/></svg>\n';

// The build stands in for the site's build: release/site/ with the texts as its page.
const builds = join(work, 'builds.log');
const BUILD = `mkdir -p release/site/tr && cp ${CONTENT_FILE} release/site/index.html && echo built >> ${builds}`;
const buildCount = () => (existsSync(builds) ? readFileSync(builds, 'utf8').split('\n').filter(Boolean).length : 0);

// The site's config, as the seed repository carries it.
const CONFIG = `export default {
  brand: { mark: 'EX', name: 'Example site', title: 'Content Bot', subtitle: "The Example site's texts" },
  editable: [
    { path: '${CONTENT_FILE}', kind: 'text', rule: 'the text inside string literals (content.tr is Turkish, content.en English); never keys or the structure' },
    { glob: 'public/**/*.svg', kind: 'svg-text' },
  ],
  layout: 'layout, code and styles: src/, public/index.html',
  build: { command: ${JSON.stringify(BUILD)}, output: 'release/site', describe: 'index.html (English), tr/index.html (Turkish)' },
  checks: 'true',
  version: 'aifactory',
  urls: { test: 'https://test.example', production: 'https://example.com' },
};
`;

// A bare origin with main holding the texts, a drawing, the config and the factory's
// records, tagged v1.0.0 (the release), and a second clone that plays the team.
const origin = join(work, 'origin.git');
execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
const seed = join(work, 'seed');
execFileSync('git', ['clone', '-q', origin, seed]);
for (const dir of ['src/content', 'public/assets/web', 'runs', 'requirements']) mkdirSync(join(seed, dir), { recursive: true });
// The version is 1.<N>.<run id>, N the highest completed requirement and the run id its run's attempt counter: 1.3.1 here.
writeFileSync(join(seed, 'requirements/RQ-0003-done.md'), '---\nid: RQ-0003\nstatus: completed\ncompletedRunId: "20260101120000-RQ-0003"\n---\n');
mkdirSync(join(seed, 'runs/20260101120000-RQ-0003'), { recursive: true });
writeFileSync(join(seed, 'runs/20260101120000-RQ-0003/manifest.json'), JSON.stringify({ steps: [{ retries: 1 }] }));
writeFileSync(join(seed, 'requirements/RQ-0004-open.md'), '---\nid: RQ-0004\nstatus: ready\n---\n');
writeFileSync(join(seed, CONTENT_FILE), CONTENT);
writeFileSync(join(seed, DRAWING_FILE), DRAWING);
writeFileSync(join(seed, 'runs/manifest.json'), '{}\n');
writeFileSync(join(seed, 'README.md'), 'site\n');
writeFileSync(join(seed, 'content-bot.config.mjs'), CONFIG);
git(seed, 'add', '-A');
git(seed, 'commit', '-q', '-m', 'seed');
git(seed, 'tag', 'v1.0.0');
git(seed, 'push', '-q', 'origin', 'HEAD:main', 'v1.0.0');
const RELEASED = git(seed, 'rev-parse', 'HEAD');

const config = await loadConfig(join(seed, 'content-bot.config.mjs'));
const editable = new Editable(config.editable);

const originFile = (path = CONTENT_FILE) => execFileSync('git', ['--git-dir', origin, 'show', `main:${path}`], { encoding: 'utf8' });
const originHead = () => execFileSync('git', ['--git-dir', origin, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
const originLog = (format, ref = 'main') => execFileSync('git', ['--git-dir', origin, 'log', '-1', `--format=${format}`, ref], { encoding: 'utf8' }).trim();

const user = { name: 'Ayşe Yılmaz', email: 'ayse@example.com' };
let nextAnswer;
let lastAsk;
let release = { tag: 'v1.0.0', commit: RELEASED };
const created = [];
const greenMain = { sha: undefined };
const makeBot = ({ checks = 'true', build = BUILD, deploy, version, platform, reads } = {}) => {
  const id = Math.random().toString(16).slice(2);
  const repo = new Repo({ dir: join(work, `clone-${id}`), url: origin });
  const own = { ...config, checks, build: { ...config.build, command: build }, ...(version ? { version } : {}) };
  const site = new Site({
    repo,
    root: join(work, `site-${id}`),
    build: own.build,
    exclude: own.exclude,
    latestRelease: async () => { if (release instanceof Error) throw release; return release; },
  });
  return new ContentBot({
    repo,
    site,
    deploy,
    platform,
    reads,
    config: own,
    releases: {
      candidate: async () => ({ sha: greenMain.sha ?? originHead(), pipeline: 'http://ci/main' }),
      create: async (args) => { created.push(args); return { tag: args.tag, url: 'http://gitlab.example/releases/x' }; },
      state: async (tag) => ({ state: tag === 'v9.9.9' ? 'deployed' : 'running', pipeline: 'http://ci/tag' }),
    },
    ask: async (prompt, schema, dirs) => { lastAsk = { prompt, schema, dirs }; return nextAnswer; },
  });
};
const session = () => ({ user, chats: new Map(), proposal: undefined });
const text = (file, edit) => ({ file: CONTENT_FILE, where: 'TR · Hero', ...edit });

test('edits: an old text found once is replaced; not found, twice or empty stops, named', () => {
  assert.equal(applyEdits('a b c', [{ old: 'b', new: 'B' }]), 'a B c');
  assert.equal(applyEdits('x $& y', [{ old: '$&', new: '$1' }]), 'x $1 y', 'replacement patterns are text');
  assert.throws(() => applyEdits('a b c', [{ old: 'z', new: 'Z' }]), /edit 1: its old text occurs 0 times/);
  assert.throws(() => applyEdits('a b b', [{ old: 'b', new: 'B' }]), /edit 1: its old text occurs 2 times/);
  assert.throws(() => applyEdits('a b c', [{ old: 'a', new: 'A' }, { old: '', new: 'x' }]), /edit 2: old is empty/);
  assert.throws(() => applyEdits('a', []), /no edits/);
});

test('file edits: the texts and a drawing\'s text change; markup, other files and paths outside the editable list are refused', () => {
  const read = (file) => ({ [CONTENT_FILE]: CONTENT, [DRAWING_FILE]: DRAWING }[file]);
  const files = applyFileEdits(read, [
    { file: DRAWING_FILE, old: 'SIMICS MODEL', new: 'HARDWARE TWIN' },
    { file: CONTENT_FILE, old: "'About text.'", new: "'About us.'" },
    { file: DRAWING_FILE, old: ' board', new: ' card' },
  ], editable);
  assert.match(files.get(DRAWING_FILE), /09 \/ HARDWARE TWIN<\/text><text x="1"><tspan>A<\/tspan> card<\/text>/);
  assert.match(files.get(CONTENT_FILE), /'About us\.'/);
  assert.throws(() => applyFileEdits(read, [{ file: DRAWING_FILE, old: 'width="260"', new: 'width="9"' }], editable), /edit 1: a drawing's old text may not contain <, > or &|edit 1: its old text is not inside/);
  assert.throws(() => applyFileEdits(read, [{ file: DRAWING_FILE, old: 'rect class', new: 'circle class' }], editable), /edit 1: its old text is not inside a <text> or <tspan> element/);
  assert.throws(() => applyFileEdits(read, [{ file: DRAWING_FILE, old: 'MODEL', new: 'MODEL</text><script>' }], editable), /edit 1: a drawing's new text may not contain/);
  assert.throws(() => applyFileEdits(read, [{ file: 'src/styles.css', old: 'a', new: 'b' }], editable), /edit 1: src\/styles\.css may not be changed; only src\/content\/site-content\.ts and the text of the drawings matching public\/\*\*\/\*\.svg may change/);
  assert.throws(() => applyFileEdits(read, [{ file: 'public/../x.svg', old: 'a', new: 'b' }], editable), /may not be changed/);
  assert.throws(() => applyFileEdits(read, [{ file: 'public/a.png', old: 'a', new: 'b' }], editable), /may not be changed/);
  assert.ok(onlyTextChanged(DRAWING, DRAWING.replace('SIMICS MODEL', 'X')));
  assert.ok(!onlyTextChanged(DRAWING, DRAWING.replace('width="260"', 'width="9"')));
  // The editable list, as the config says it: a path exactly, a glob across segments, nothing else.
  assert.equal(editable.kindOf('public/a.svg'), 'svg-text');
  assert.equal(editable.kindOf('public/a/b/c.svg'), 'svg-text');
  assert.equal(editable.kindOf('publicx/a.svg'), undefined);
  assert.equal(editable.kindOf('src/content/site-content.ts'), 'text');
  assert.equal(editable.kindOf('src/content/site-content.tsx'), undefined);
  assert.match(editable.describe(), /src\/content\/site-content\.ts: the text inside string literals/);
  assert.match(editable.describe(), /drawings matching public\/\*\*\/\*\.svg: the text inside <text> and <tspan> elements only/);
});

test('claude: read-only tools and the directories are passed; the answer comes back; "Not logged in" reads as such, whatever the exit code', async () => {
  const fake = join(work, 'claude');
  writeFileSync(fake, '#!/bin/sh\ncat > /dev/null\nprintf "%s\\n" "$PWD" "$@" > "$FAKE_ARGS"\ncat "$FAKE_ENVELOPE"\nexit "${FAKE_EXIT:-0}"\n');
  chmodSync(fake, 0o755);
  const envelope = join(work, 'envelope.json');
  process.env.FAKE_ENVELOPE = envelope;
  process.env.FAKE_ARGS = join(work, 'args.txt');
  const ask = () => askClaude({ executable: fake, model: 'm', prompt: 'p', schema: {}, dirs: ['/copies/main', '/copies/test'] });
  writeFileSync(envelope, JSON.stringify({ is_error: false, result: '', structured_output: { reply: 'ok', summary: 's', edits: [] } }));
  assert.deepEqual(await ask(), { reply: 'ok', summary: 's', edits: [] });
  const [cwd, ...args] = readFileSync(process.env.FAKE_ARGS, 'utf8').trim().split('\n');
  assert.match(cwd, /content-bot-claude-/, 'claude runs in a throwaway directory');
  assert.equal(args[args.indexOf('--allowedTools') + 1], ALLOWED_TOOLS.join(' '));
  assert.deepEqual(ALLOWED_TOOLS, ['Read', 'Glob', 'Grep']);
  const denied = args[args.indexOf('--disallowedTools') + 1].split(' ');
  for (const tool of ['Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch']) assert.ok(denied.includes(tool), `${tool} is denied`);
  assert.deepEqual(args.slice(args.indexOf('--add-dir') + 1, args.indexOf('--add-dir') + 3), ['/copies/main', '/copies/test']);
  assert.equal(args[args.indexOf('--permission-prompts') + 1], 'none');

  writeFileSync(envelope, JSON.stringify({ is_error: false, result: '{"reply":"r","summary":"s","edits":[]}' }));
  assert.equal((await ask()).reply, 'r');
  writeFileSync(envelope, JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }));
  process.env.FAKE_EXIT = '1';
  await assert.rejects(ask(), (error) => error.message === NOT_LOGGED_IN);
  writeFileSync(envelope, JSON.stringify({ is_error: true, result: 'Overloaded' }));
  await assert.rejects(ask(), /^Error: claude: Overloaded$/);
  writeFileSync(envelope, 'boom');
  await assert.rejects(ask(), /claude exited with 1: boom/);
  delete process.env.FAKE_EXIT;
});

test('the copies: main without the excluded records, the built test site per commit, production at the release tag; the prompt comes from the config', async () => {
  const bot = makeBot();
  nextAnswer = { reply: 'Bulunan: …', summary: '', edits: [] };
  const before = buildCount();
  await bot.propose(session(), 'simics nerede?');
  const [main, built, production] = lastAsk.dirs;
  assert.equal(lastAsk.dirs.length, 3);
  assert.equal(readFileSync(join(main, DRAWING_FILE), 'utf8'), DRAWING);
  assert.ok(!existsSync(join(main, 'runs')), 'runs/ is left out');
  assert.ok(!existsSync(join(main, '.git')), 'no .git in a copy');
  assert.equal(readFileSync(join(built, 'index.html'), 'utf8'), CONTENT);
  assert.equal(readFileSync(join(production, CONTENT_FILE), 'utf8'), CONTENT);
  assert.match(lastAsk.prompt, new RegExp(`MAIN = ${main}`));
  assert.match(lastAsk.prompt, /PRODUCTION = .* release v1\.0\.0 .*what https:\/\/example\.com serves; main is 0 commit\(s\) ahead/);
  assert.match(lastAsk.prompt, /The user's request now:\nsimics nerede\?/);
  assert.doesNotMatch(lastAsk.prompt, /Cihazdan buluta/, 'the file is read by Claude, not pasted');
  assert.match(lastAsk.prompt, /^You are Content Bot\. You answer questions about the Example site/, 'the brand names the bot and the site');
  assert.match(lastAsk.prompt, /You may change only:\n  - src\/content\/site-content\.ts: the text inside string literals \(content\.tr is Turkish/, "the editable list's rules");
  assert.match(lastAsk.prompt, /- the drawings matching public\/\*\*\/\*\.svg: the text inside <text> and <tspan> elements only/);
  assert.match(lastAsk.prompt, /Editable: src\/content\/site-content\.ts, public\/\*\*\/\*\.svg; layout, code and styles: src\/, public\/index\.html\./, 'the layout line');
  assert.match(lastAsk.prompt, /TEST = .* that https:\/\/test\.example serves for that commit: index\.html \(English\), tr\/index\.html \(Turkish\)\./, 'build.describe');
  assert.equal(buildCount(), before + 1);

  await bot.propose(session(), 'again');
  assert.equal(buildCount(), before + 1, 'an unchanged main is not built again');
  assert.equal(lastAsk.dirs[1], built);
});

test('the copies: a failing build, a build without its output and a missing release are named, and the request still runs', async () => {
  release = null;
  const bot = makeBot({ build: 'echo "tsc: error TS2304" >&2; exit 2' });
  nextAnswer = { reply: 'ok', summary: '', edits: [] };
  try {
    await bot.propose(session(), 'x');
    assert.equal(lastAsk.dirs.length, 1);
    assert.match(lastAsk.prompt, /TEST: not available \(tsc: error TS2304\)/);
    assert.match(lastAsk.prompt, /PRODUCTION: not available \(there is no GitLab Release yet\)/);
    await makeBot({ build: 'true' }).propose(session(), 'x');
    assert.match(lastAsk.prompt, /TEST: not available \(the build left no release\/site\/ directory\)/);
    release = new Error('GitLab answered 503 for the releases');
    const other = makeBot();
    await other.propose(session(), 'x');
    assert.match(lastAsk.prompt, /PRODUCTION: not available \(GitLab answered 503 for the releases\)/);
    assert.deepEqual((await other.status()).production, { error: 'GitLab answered 503 for the releases' });
  } finally {
    release = { tag: 'v1.0.0', commit: RELEASED };
  }
});

const GITHUB = { name: 'GitHub', releaseRole: 'a collaborator with the maintain or admin role' };
test('the prompt says how the model reads: Read, Glob and Grep for claude (the default), read-only shell commands for codex', async () => {
  nextAnswer = { reply: 'ok', summary: '', edits: [] };
  await makeBot().propose(session(), 'x');
  assert.match(lastAsk.prompt, /You read the site with Read, Glob and Grep \(absolute paths, in the\ndirectories below\)/);
  await makeBot({ reads: 'with read-only shell commands (ls, cat, rg) in a read-only sandbox' }).propose(session(), 'x');
  assert.match(lastAsk.prompt, /You read the site with read-only shell commands \(ls, cat, rg\) in a read-only sandbox \(absolute paths/);
  assert.doesNotMatch(lastAsk.prompt, /Read, Glob and Grep/);
});

test('on GitHub, the prompt and the refusals name GitHub and its roles', async () => {
  release = null;
  const bot = makeBot({ platform: GITHUB });
  nextAnswer = { reply: 'ok', summary: '', edits: [] };
  try {
    await bot.propose(session(), 'x');
    assert.match(lastAsk.prompt, /PRODUCTION: not available \(there is no GitHub Release yet\)/);
  } finally {
    release = { tag: 'v1.0.0', commit: RELEASED };
  }
  const writer = { ...user, accessLevel: 30 };
  const preview = await bot.releasePreview(writer);
  assert.equal(preview.canRelease, false);
  assert.equal(preview.reason, 'Only a collaborator with the maintain or admin role can release.');
  await assert.rejects(bot.release(writer, { tag: 'v1.0.1', sha: preview.candidate.sha }), /Only a collaborator with the maintain or admin role can release\./);
  const maintainer = { ...user, accessLevel: 40 };
  assert.equal((await bot.releasePreview(maintainer)).canRelease, true, 'maintain releases, as a Maintainer does');
});

test('a request becomes a proposal and writes nothing; Apply commits only the content file as the user and pushes it', async () => {
  const bot = makeBot();
  const s = session();
  const before = originHead();
  nextAnswer = { reply: 'Değiştirdim.', summary: 'TR hero', edits: [text(null, { old: "'Cihazdan buluta.'", new: "'Cihazdan buluta, ödünsüz.'" })] };
  const answer = await bot.propose(s, 'Türkçe başlığı değiştir');
  assert.equal(answer.reply, 'Değiştirdim.');
  assert.ok(answer.proposal?.id);
  assert.equal(answer.proposal.edits[0].where, 'TR · Hero');
  assert.equal(originHead(), before, 'a proposal pushes nothing');
  assert.deepEqual(await bot.repo.changedFiles(), [], 'a proposal writes nothing');

  const { sha } = await bot.apply(s, answer.proposal.id);
  assert.equal(originHead(), sha);
  assert.match(originFile(), /'Cihazdan buluta, ödünsüz\.'/);
  assert.equal(originLog('%an <%ae>'), 'Ayşe Yılmaz <ayse@example.com>');
  assert.equal(originLog('%cn'), 'content-bot');
  assert.equal(originLog('%s'), 'content: TR hero');
  assert.match(originLog('%b'), /Request: Türkçe başlığı değiştir/);
  assert.equal(originLog('%(trailers:key=Content-bot,valueonly)'), 'yes');
  assert.equal(originLog('%(trailers:key=Requested-by,valueonly)'), 'Ayşe Yılmaz <ayse@example.com>');
  assert.equal(execFileSync('git', ['--git-dir', origin, 'diff', '--name-only', `${sha}~1`, sha], { encoding: 'utf8' }).trim(), CONTENT_FILE);
  assert.equal(s.proposal, undefined);
  await assert.rejects(bot.apply(s, answer.proposal.id), /no such proposal/, 'a proposal applies once');
});

test('a drawing\'s text is changed and pushed like a text; the guard refuses markup changes and other files', async () => {
  const bot = makeBot();
  const s = session();
  nextAnswer = { reply: 'Done.', summary: 'Drawing: hardware twin', edits: [{ file: DRAWING_FILE, where: 'Drawing · models', old: 'SIMICS MODEL', new: 'HARDWARE TWIN' }] };
  const { proposal } = await bot.propose(s, 'change SIMICS MODEL to HARDWARE TWIN in the drawing');
  const { sha } = await bot.apply(s, proposal.id);
  assert.equal(originHead(), sha);
  assert.match(originFile(DRAWING_FILE), /09 \/ HARDWARE TWIN/);
  assert.equal(execFileSync('git', ['--git-dir', origin, 'diff', '--name-only', `${sha}~1`, sha], { encoding: 'utf8' }).trim(), DRAWING_FILE);

  nextAnswer = { reply: 'ok', summary: 'x', edits: [{ file: DRAWING_FILE, where: 'Drawing', old: 'rect class', new: 'circle class' }] };
  const refused = await bot.propose(s, 'x');
  assert.equal(refused.proposal, undefined);
  assert.match(refused.error, /not inside a <text> or <tspan> element/);

  const before = originHead();
  const path = join(bot.repo.dir, DRAWING_FILE);
  await assert.rejects(
    bot.publish(user, 'content: x', 'Request: x', () => writeFileSync(path, readFileSync(path, 'utf8').replace('width="260"', 'width="9"')), { kind: 'yes' }),
    /refused: the change to public\/assets\/web\/models\.svg reaches past its text/,
  );
  await assert.rejects(
    bot.publish(user, 'content: x', 'Request: x', () => writeFileSync(join(bot.repo.dir, 'public/assets/web/new.svg'), '<svg/>'), { kind: 'yes' }),
    /refused: public\/assets\/web\/new\.svg would be added or removed/,
  );
  assert.equal(originHead(), before);
});

test('an answer without edits is a question; an edit that does not fit is not offered; each chat has its own memory', async () => {
  const bot = makeBot();
  const s = session();
  nextAnswer = { reply: 'Hangi başlık?', summary: '', edits: [] };
  assert.deepEqual(await bot.propose(s, 'başlığı değiştir', 'chat-a'), { reply: 'Hangi başlık?' });
  nextAnswer = { reply: 'Tamam.', summary: 'x', edits: [text(null, { old: 'not in the file', new: 'y' })] };
  const answer = await bot.propose(s, 'x', 'chat-a');
  assert.equal(answer.proposal, undefined);
  assert.match(answer.error, /occurs 0 times/);
  assert.equal(s.chats.get('chat-a').length, 4, 'the conversation is kept for the next request');
  assert.match(lastAsk.prompt, /The conversation so far:\nuser: başlığı değiştir\nassistant: Hangi başlık\?/);
  nextAnswer = { reply: 'ok', summary: '', edits: [] };
  await bot.propose(s, 'new topic', 'chat-b');
  assert.doesNotMatch(lastAsk.prompt, /The conversation so far/, 'a new chat starts with no memory');
});

test('the guard refuses a change outside the editable files, and a failing check pushes nothing', async () => {
  const before = originHead();
  const guarded = makeBot();
  await assert.rejects(
    guarded.publish(user, 'content: x', 'Request: x', () => writeFileSync(join(guarded.repo.dir, 'README.md'), 'changed\n'), { kind: 'yes' }),
    /refused: the change touches README\.md; only src\/content\/site-content\.ts and the text of the drawings matching public\/\*\*\/\*\.svg may change/,
  );
  const failing = makeBot({ checks: 'echo "type error in site-content.ts" >&2; exit 1' });
  const s = session();
  nextAnswer = { reply: 'ok', summary: 'EN about', edits: [text(null, { old: "'About text.'", new: "'About us.'" })] };
  const { proposal } = await failing.propose(s, 'about');
  await assert.rejects(failing.apply(s, proposal.id), /the site's checks failed, nothing was pushed:\ntype error in site-content\.ts/);
  assert.equal(originHead(), before);
});

test('a push that loses a race with another commit on main is made again on the new main', async () => {
  // The checks, the first time only, push a commit of the team's to main before the bot pushes.
  const team = join(work, 'team');
  execFileSync('git', ['clone', '-q', origin, team]);
  const once = join(work, 'raced');
  const race = `[ -e ${once} ] || { touch ${once}; cd ${team} && git pull -q && echo more >> README.md && git -c user.name=Team -c user.email=team@example.com commit -qam team && git push -q origin HEAD:main; }`;
  const bot = makeBot({ checks: race });
  const s = session();
  nextAnswer = { reply: 'ok', summary: 'EN hero', edits: [text(null, { old: "'From device to cloud.'", new: "'From device to cloud, engineered.'" })] };
  const { proposal } = await bot.propose(s, 'en hero');
  const { sha } = await bot.apply(s, proposal.id);
  assert.equal(originHead(), sha);
  assert.equal(originLog('%s', 'main~1'), 'team', "the team's commit stays, the bot's comes after it");
  assert.match(originFile(), /engineered/);
});

test('Undo reverts the latest bot change and pushes it; the next Undo finds the one before', async () => {
  const bot = makeBot();
  const s = session();
  nextAnswer = { reply: 'ok', summary: 'TR about', edits: [text(null, { old: "'Hakkımızda metni.'", new: "'Biz kimiz.'" })] };
  const { proposal } = await bot.propose(s, 'tr about');
  const { sha } = await bot.apply(s, proposal.id);
  const latest = await bot.undoable();
  assert.equal(latest.sha, sha);
  await assert.rejects(bot.undo(user, 'f'.repeat(40)), /no longer the one shown/);
  const undone = await bot.undo(user, sha);
  assert.equal(originHead(), undone.sha);
  assert.match(originFile(), /'Hakkımızda metni\.'/);
  assert.equal(originLog('%s'), 'content: undo "TR about"');
  assert.equal(originLog('%(trailers:key=Content-bot,valueonly)'), 'undo');
  assert.equal(originLog('%(trailers:key=Reverts,valueonly)'), sha);
  const next = await bot.undoable();
  assert.notEqual(next?.sha, sha, 'an undone change is not offered again');
  assert.equal(next?.subject, 'content: EN hero');
});

test('recent changes: each bot commit with where it is, and the one Undo would revert; the status names the release and the versions', async () => {
  const deployed = new Set();
  const bot = makeBot({ deploy: async (sha) => (deployed.has(sha) ? { state: 'deployed', pipeline: 'http://ci/1' } : { state: 'running', pipeline: 'http://ci/2' }) });
  const s = session();
  nextAnswer = { reply: 'ok', summary: 'EN about', edits: [text(null, { old: "'About text.'", new: "'About the company.'" })] };
  const { proposal } = await bot.propose(s, 'en about');
  const { sha } = await bot.apply(s, proposal.id);

  let { changes, undoable } = await bot.changes();
  assert.equal(undoable, sha);
  assert.deepEqual(
    changes.slice(0, 4).map((change) => [change.subject, change.state]),
    [['content: EN about', 'pipeline'], ['content: undo "TR about"', 'pipeline'], ['content: TR about', 'undone'], ['content: EN hero', 'pipeline']],
  );
  assert.equal(changes[0].author, 'Ayşe Yılmaz');
  assert.equal(changes[0].pipeline, 'http://ci/2');
  deployed.add(sha);
  ({ changes } = await bot.changes());
  assert.equal(changes[0].state, 'test');

  // Released: the newest change is in the tag production serves.
  git(seed, 'fetch', '-q', 'origin');
  git(seed, 'tag', 'v1.1.0', 'origin/main');
  git(seed, 'push', '-q', 'origin', 'v1.1.0');
  release = { tag: 'v1.1.0', commit: originHead() };
  try {
    const fresh = makeBot();
    ({ changes } = await fresh.changes());
    assert.equal(changes[0].state, 'production');
    const status = await fresh.status();
    assert.equal(status.production.tag, 'v1.1.0');
    assert.equal(status.production.ahead, 0);
    assert.deepEqual(status.main.version, { version: '1.3.1', requirement: 'RQ-0003', run: 1 }, 'a ready requirement does not count');
    assert.equal(status.main.sha, originHead());
    assert.equal(status.testUrl, 'https://test.example');
    assert.equal(status.policy, '1.<last requirement>.<its run id>');
    const patched = await makeBot({ version: 'patch' }).status();
    assert.equal(patched.main.version, null, 'the patch policy has no version for a commit');
    assert.equal(patched.policy, "production's version with the patch number raised");
  } finally {
    release = { tag: 'v1.0.0', commit: RELEASED };
  }
});

// A GitLab that answers the OAuth token, the user and the project membership.
const fakeGitLab = ({ access = 30, state = 'active', email = 'ayse@example.com' } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url.endsWith('/oauth/token')) return init.body.get('code') === 'good-code' ? reply(200, { access_token: 'user-token' }) : reply(400, {});
    if (url.endsWith('/api/v4/user')) return reply(200, { id: 7, username: 'ayse', name: user.name, email, state });
    if (url.includes('/members/all/7')) return access ? reply(200, { access_level: access }) : reply(404, {});
    return reply(404, {});
  };
  const auth = new GitLabAuth({ url: 'http://gitlab.example/', clientId: 'app-id', secret: 'app-secret', redirectUri: 'http://bot.example/auth/callback', project: 'group/site', token: 'bot-token', fetchImpl });
  return { auth, calls };
};

test('GitLab login: the state must come back; a member at Developer or above gets in as their GitLab name and e-mail', async () => {
  const { auth, calls } = fakeGitLab();
  const { state, location } = auth.start();
  const target = new URL(location);
  assert.equal(`${target.origin}${target.pathname}`, 'http://gitlab.example/oauth/authorize');
  assert.deepEqual(Object.fromEntries(target.searchParams), { client_id: 'app-id', redirect_uri: 'http://bot.example/auth/callback', response_type: 'code', state, scope: 'read_user' });
  await assert.rejects(auth.finish({ code: 'good-code', state, cookieState: 'other' }), /did not start here/);
  const again = auth.start();
  assert.deepEqual(await auth.finish({ code: 'good-code', state: again.state, cookieState: again.state }), { name: user.name, email: user.email, username: 'ayse', accessLevel: 30 });
  await assert.rejects(auth.finish({ code: 'good-code', state: again.state, cookieState: again.state }), /did not start here/, 'a state is used once');
  const token = calls.find((call) => call.url.endsWith('/oauth/token'));
  assert.equal(token.init.body.get('client_secret'), 'app-secret');
  assert.equal(calls.find((call) => call.url.includes('/members/all/')).url, 'http://gitlab.example/api/v4/projects/group%2Fsite/members/all/7');
  assert.equal(calls.find((call) => call.url.includes('/members/all/')).init.headers['PRIVATE-TOKEN'], 'bot-token');

  for (const [options, refusal] of [[{ access: 20 }, /is not a Developer \(or above\) of group\/site/], [{ access: 0 }, /is not a Developer/], [{ state: 'blocked' }, /is not active/]]) {
    const other = fakeGitLab(options).auth;
    const begun = other.start();
    await assert.rejects(other.finish({ code: 'good-code', state: begun.state, cookieState: begun.state }), refusal);
  }
});

test('the server: /auth/login goes to GitLab, the callback makes a session, a refusal comes back to the page; the API needs a session; the page carries the brand, in English', async () => {
  const { auth } = fakeGitLab();
  const llm = { provider: 'claude-cli (subscription)', model: 'claude-sonnet-5-5' };
  const login = { platform: 'GitLab', host: 'gitlab.example', project: 'group/site', access: 'Developer' };
  const server = createApp({ auth, bot: makeBot(), deploy: async () => ({ state: 'unknown' }), config, llm, login });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers = {}) => fetch(`${base}${path}`, { headers, redirect: 'manual' });
  try {
    assert.equal((await get('/api/me')).status, 401);
    assert.equal((await get('/api/changes')).status, 401);
    assert.equal((await fetch(`${base}/api/message`, { method: 'POST', body: '{"text":"x"}' })).status, 401);
    assert.equal((await fetch(`${base}/api/login`, { method: 'POST', body: '{}' })).status, 404, 'no password login');

    const start = await get('/auth/login');
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const stateCookie = start.headers.get('set-cookie');
    assert.match(stateCookie, /^content_bot_login=[a-f0-9]{48}; HttpOnly; SameSite=Lax; Path=\/auth/);

    const refused = await get(`/auth/callback?code=good-code&state=${state}`);
    assert.equal(refused.status, 302);
    assert.match(decodeURIComponent(refused.headers.get('location')), /^\/\?login_error=The login took too long or did not start here/);
    const cancelled = await get('/auth/callback?error=access_denied&error_description=The+user+denied+access');
    assert.equal(decodeURIComponent(cancelled.headers.get('location')), '/?login_error=The user denied access');

    const second = await get('/auth/login');
    const secondState = new URL(second.headers.get('location')).searchParams.get('state');
    const done = await get(`/auth/callback?code=good-code&state=${secondState}`, { cookie: second.headers.get('set-cookie').split(';')[0] });
    assert.equal(done.headers.get('location'), '/');
    const session = done.headers.getSetCookie().find((cookie) => cookie.startsWith('content_bot_session='));
    assert.match(session, /HttpOnly; SameSite=Strict/);
    const cookie = session.split(';')[0];
    assert.deepEqual(await (await get('/api/me', { cookie })).json(), {
      user: { ...user, username: 'ayse', accessLevel: 30 },
      testUrl: 'https://test.example',
      prodUrl: 'https://example.com',
      llm,
      brand: { mark: 'EX', name: 'Example site', title: 'Content Bot', subtitle: "The Example site's texts" },
      policy: '1.<last requirement>.<its run id>',
      platform: 'GitLab',
    });
    const preview = await (await get('/api/release', { cookie })).json();
    assert.equal(preview.canRelease, false, 'a Developer may not release');
    assert.equal((await fetch(`${base}/api/release`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ tag: 'v1.0.9', sha: preview.candidate.sha }) })).status, 403);
    const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
    assert.equal((await post('/api/message', { text: 'x', chat: '../../etc' })).status, 400);
    assert.equal((await (await get('/api/status', { cookie })).json()).production.tag, 'v1.0.0');
    assert.ok(Array.isArray((await (await get('/api/changes', { cookie })).json()).changes));
    assert.equal((await post('/api/logout', {})).status, 200);
    assert.equal((await get('/api/me', { cookie })).status, 401, 'logged out');

    const page = await (await get('/')).text();
    assert.match(page, /<title>Content Bot<\/title>/);
    assert.match(page, /href="\/auth\/login">Log in with GitLab</);
    assert.match(page, /With your GitLab account \(gitlab\.example\)\. Members of the group\/site project with Developer access or above can come in\./, 'the login sentence from the settings');
    assert.match(page, /title="The GitLab Release production serves"/);
    assert.match(page, /title="Example site">EX<\/div>/, 'the brand mark');
    assert.match(page, /<span>The Example site&#39;s texts<\/span>/, 'the subtitle, escaped');
    assert.doesNotMatch(page, /\{\{\w+\}\}/, 'every placeholder is filled');
    assert.doesNotMatch(page, /Uygula|Vazgeç|Giriş|Gönder|geri al|type="password"/, 'the page itself is English, with no password field');
  } finally {
    server.close();
  }
});

const NEXT = 'v1.3.1';
test('release: what the test site serves since production\'s tag, for a Maintainer only, at the commit shown, with the policy\'s version', async () => {
  const bot = makeBot();
  const maintainer = { ...user, accessLevel: 40 };
  const developer = { ...user, accessLevel: 30 };
  const head = originHead();
  greenMain.sha = execFileSync('git', ['--git-dir', origin, 'rev-parse', 'main~1'], { encoding: 'utf8' }).trim();
  try {
    const preview = await bot.releasePreview(maintainer);
    assert.equal(preview.production.tag, 'v1.0.0');
    assert.equal(preview.candidate.sha, greenMain.sha);
    assert.equal(preview.next, NEXT, 'fixed: v1.<last requirement>.<its run>');
    assert.equal(preview.policy, '1.<last requirement>.<its run id>');
    assert.equal(preview.canRelease, true);
    assert.ok(preview.changes.length > 3);
    assert.ok(!preview.changes.some((change) => change.sha === head), 'a commit not on the test site does not ship');
    assert.deepEqual(preview.pending.map((change) => change.sha), [head]);
    assert.ok(preview.changes.some((change) => change.subject === 'team'), "the team's commits ship too");

    const developerPreview = await bot.releasePreview(developer);
    assert.equal(developerPreview.canRelease, false);
    assert.match(developerPreview.reason, /Maintainer or Owner/);
    await assert.rejects(bot.release(developer, { tag: 'v1.0.1', sha: greenMain.sha }), (error) => error.status === 403);
    for (const tag of ['1.0.1', 'v1.0', 'v1.0.1-rc1', 'v1.0.1 ', 'V1.0.1']) await assert.rejects(bot.release(maintainer, { tag, sha: greenMain.sha }), /must look like v1\.2\.3/, tag);
    for (const tag of ['v1.0.0', 'v1.0.1', 'v2.0.0']) await assert.rejects(bot.release(maintainer, { tag, sha: greenMain.sha }), /The version is fixed: v1\.3\.1 \(1\.<last requirement>\.<its run id>\)/, tag);
    await assert.rejects(bot.release(maintainer, { tag: 'v1.0.1', sha: head }), /has moved on since you looked/);
    assert.equal(created.length, 0);

    // The patch policy on the same repository: production's v1.0.0 becomes v1.0.1.
    const patched = await makeBot({ version: 'patch' }).releasePreview(maintainer);
    assert.equal(patched.next, 'v1.0.1');
    // The site's own rule reads the candidate commit.
    const own = await makeBot({ version: async ({ candidate, production, read }) => `${production.tag.slice(1, 2)}.9.${(await read('README.md')).trim().length}` }).releasePreview(maintainer);
    assert.equal(own.next, 'v1.9.9', 'README.md is "site\\nmore\\n" trimmed: 9 characters');
    await assert.rejects(makeBot({ version: async () => 'latest' }).releasePreview(maintainer), /the site's version rule returned "latest", not MAJOR\.MINOR\.PATCH/);

    assert.deepEqual(await bot.release(maintainer, { tag: NEXT, title: 'ignored', sha: greenMain.sha }), { tag: NEXT, url: 'http://gitlab.example/releases/x' });
    const [made] = created;
    assert.equal(made.tag, NEXT);
    assert.equal(made.ref, greenMain.sha);
    assert.equal(made.name, NEXT, 'the title is the version');
    assert.match(made.description, /^Released from Content Bot by Ayşe Yılmaz <ayse@example\.com>\.\n\nChanges since v1\.0\.0:\n\n- /);
    assert.match(made.description, /- content: TR hero \(Ayşe Yılmaz, [0-9a-f]{8}\)/);
    assert.doesNotMatch(made.description, /EN about/, 'the commit not on the test site is not listed');
    assert.deepEqual(await bot.releaseState('v9.9.9'), { state: 'deployed', pipeline: 'http://ci/tag' });
    await assert.rejects(bot.releaseState('main'), /must look like/);
  } finally {
    greenMain.sha = undefined;
  }
});

test('release: nothing to release at the commit production runs; a push after it, without a new requirement, is its last number + 1', async () => {
  const maintainer = { ...user, accessLevel: 40 };
  greenMain.sha = execFileSync('git', ['--git-dir', origin, 'rev-parse', 'main~1'], { encoding: 'utf8' }).trim();
  git(seed, 'fetch', '-q', 'origin');
  git(seed, 'tag', NEXT, greenMain.sha);
  git(seed, 'push', '-q', 'origin', NEXT);
  release = { tag: NEXT, commit: greenMain.sha };
  try {
    const preview = await makeBot().releasePreview(maintainer);
    assert.equal(preview.next, NEXT);
    assert.equal(preview.canRelease, false);
    assert.equal(preview.unchanged, 'No changes to release: production already runs v1.3.1 and nothing has been pushed to main since.');
    assert.equal(preview.reason, preview.unchanged);
    await assert.rejects(makeBot().release(maintainer, { tag: NEXT, sha: greenMain.sha }), /Nothing has changed|already in production/);
    // The next commit on main, with no new requirement: v1.3.2.
    greenMain.sha = originHead();
    const after = await makeBot().releasePreview(maintainer);
    assert.equal(after.next, 'v1.3.2');
    assert.equal(after.canRelease, true);
    assert.equal(after.unchanged, undefined);
    assert.equal((await makeBot().status()).main.version.version, '1.3.2', 'the sidebar shows the same version');
    const page = readFileSync(PAGE_FILE, 'utf8');
    assert.match(page, /if \(preview\.unchanged\) \{[^}]*submit\.hidden = true;/, 'no release button, only the note');
  } finally {
    release = { tag: 'v1.0.0', commit: RELEASED };
    greenMain.sha = undefined;
  }
});
