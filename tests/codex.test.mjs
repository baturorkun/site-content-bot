// The codex CLI as the bot's language model, against a fake codex: its
// arguments (a read-only sandbox, no approvals, a throwaway directory, the
// schema file, the model only when given), the prompt on stdin, the answer
// from the last-message file; an empty or non-JSON answer, a failure, a login
// failure, a missing executable; the LLM choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { askCodex, CODEX_NOT_LOGGED_IN, LLMS, llmOf, makeAsk } from '../dist/index.js';

const work = mkdtempSync(join(tmpdir(), 'content-bot-codex-test-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

// The fake: records its cwd, arguments, stdin and the schema file; writes
// $FAKE_MESSAGE to the last-message file; prints $FAKE_STDERR; exits $FAKE_EXIT.
const fake = join(work, 'codex');
writeFileSync(fake, `#!/bin/sh
out=""; schema=""
for a in "$@"; do :; done
printf "%s\\n" "$PWD" > "$FAKE_LOG"; printf "%s\\n" "$@" >> "$FAKE_LOG"
prev=""
for a in "$@"; do
  [ "$prev" = --output-last-message ] && out="$a"
  [ "$prev" = --output-schema ] && schema="$a"
  prev="$a"
done
cat > "$FAKE_STDIN"
[ -n "$schema" ] && cp "$schema" "$FAKE_SCHEMA"
[ -n "$FAKE_MESSAGE" ] && printf '%s' "$FAKE_MESSAGE" > "$out"
[ -n "$FAKE_STDERR" ] && printf '%s\\n' "$FAKE_STDERR" >&2
exit "\${FAKE_EXIT:-0}"
`);
chmodSync(fake, 0o755);
Object.assign(process.env, { FAKE_LOG: join(work, 'log'), FAKE_STDIN: join(work, 'stdin'), FAKE_SCHEMA: join(work, 'schema') });
const set = (values) => { for (const key of ['FAKE_MESSAGE', 'FAKE_STDERR', 'FAKE_EXIT']) delete process.env[key]; Object.assign(process.env, values); };
const SCHEMA = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false };
const ask = (model = '') => askCodex({ executable: fake, model, prompt: 'the prompt\nwith lines', schema: SCHEMA, dirs: ['/copies/main'] });

test('the arguments: a read-only sandbox and no approvals before exec, a throwaway directory, the schema file, the prompt on stdin, - last', async () => {
  set({ FAKE_MESSAGE: '{"reply":"ok"}' });
  assert.deepEqual(await ask(), { reply: 'ok' });
  const [pwd, ...args] = readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n');
  const cwd = args[5];
  assert.match(cwd, /content-bot-codex-/, 'a throwaway working directory');
  assert.equal(pwd, realpathSync(dirname(cwd)) + '/' + basename(cwd), 'codex runs in it');
  assert.equal(existsSync(cwd), false, 'removed afterwards');
  assert.deepEqual(args.slice(0, 5), ['--sandbox', 'read-only', '--ask-for-approval', 'never', '--cd']);
  const exec = args.indexOf('exec');
  assert.equal(exec, 6, 'no --model when none is given');
  for (const flag of ['--ephemeral', '--ignore-user-config', '--skip-git-repo-check']) assert.ok(args.indexOf(flag) > exec, flag);
  assert.equal(args[args.indexOf('--color') + 1], 'never');
  assert.equal(args.at(-1), '-', 'the prompt from stdin');
  assert.equal(readFileSync(process.env.FAKE_STDIN, 'utf8'), 'the prompt\nwith lines');
  assert.deepEqual(JSON.parse(readFileSync(process.env.FAKE_SCHEMA, 'utf8')), SCHEMA);
  await ask('gpt-x');
  const withModel = readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n').slice(1);
  assert.deepEqual(withModel.slice(6, 9), ['--model', 'gpt-x', 'exec']);
});

test('the answer: empty or not JSON is refused; a failure names its exit; a login failure is the codex login message; a missing codex is named', async () => {
  set({});
  await assert.rejects(ask(), /^Error: codex finished without an answer$/);
  set({ FAKE_MESSAGE: 'Sure! Here it is.' });
  await assert.rejects(ask(), /codex's answer is not the JSON asked for: Sure! Here it is\./);
  set({ FAKE_EXIT: '2', FAKE_STDERR: 'stream disconnected' });
  await assert.rejects(ask(), /^Error: codex exited with 2: stream disconnected$/);
  for (const said of ['Not logged in. Run codex login', 'unexpected status 401 Unauthorized', 'Error: missing auth.json']) {
    set({ FAKE_EXIT: '1', FAKE_STDERR: said });
    await assert.rejects(ask(), (error) => error.message === CODEX_NOT_LOGGED_IN, said);
  }
  await assert.rejects(askCodex({ executable: join(work, 'nowhere'), model: '', prompt: 'p', schema: SCHEMA }), /^Error: codex could not be started: /);
  assert.match(CODEX_NOT_LOGGED_IN, /codex login --device-auth/);
});

test('the choice: empty is claude, codex is codex, anything else refused; makeAsk calls the chosen CLI; each says how it reads and logs in', async () => {
  assert.equal(llmOf(undefined), 'claude');
  assert.equal(llmOf(''), 'claude');
  assert.equal(llmOf('codex'), 'codex');
  assert.throws(() => llmOf('gpt'), /CONTENT_BOT_LLM is "gpt"; it is one of claude, codex/);
  set({ FAKE_MESSAGE: '{"reply":"from codex"}' });
  assert.deepEqual(await makeAsk({ llm: 'codex', executable: fake, model: '' })('p', SCHEMA, []), { reply: 'from codex' });
  assert.equal(LLMS.claude.defaultModel, 'claude-opus-5-5');
  assert.equal(LLMS.codex.defaultModel, '');
  assert.equal(LLMS.claude.reads, 'with Read, Glob and Grep');
  assert.match(LLMS.codex.reads, /read-only sandbox/);
  assert.match(LLMS.codex.login, /^codex login --device-auth/);
  assert.equal(LLMS.codex.provider, 'codex-cli');
});
