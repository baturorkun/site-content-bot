// One answer from the signed-in `codex` CLI (a ChatGPT login or an API key),
// run as aifactory's codex-cli adapter runs it: a read-only sandbox with no
// approvals (it may read the copies, whose absolute paths are in the prompt,
// and write nothing, with no network), a throwaway working directory so no
// project AGENTS.md is read as instructions, the prompt on stdin, the answer
// held to the schema (--output-schema) and taken from the last message.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AskOptions } from './claude.js';

export const CODEX_NOT_LOGGED_IN = 'Codex is not logged in in the container: run `codex login --device-auth` in it (docker exec -it <container> codex login --device-auth).';
const LOGIN_PROBLEM = /not logged in|codex login|\blogin\b|401|unauthori[sz]ed|authenticat|auth\.json|api key/i;

interface Run { code: number | null; stdout: string; stderr: string }

const run = (executable: string, args: string[], stdin: string, cwd: string, timeoutMs: number): Promise<Run> => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => { clearTimeout(timer); reject(new Error(`codex could not be started: ${error.message}`)); });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (signal === 'SIGKILL') return reject(new Error(`codex did not answer within ${Math.round(timeoutMs / 1000)} s`));
    resolve({ code, stdout, stderr });
  });
  child.stdin.end(stdin);
});

const short = (text: unknown): string => String(text).replace(/\s+/g, ' ').trim().slice(0, 300);

// The arguments, global options before exec as codex wants them.
export const codexArgs = ({ cwd, model, outputFile, schemaFile }: { cwd: string; model?: string; outputFile: string; schemaFile: string }): string[] => [
  '--sandbox', 'read-only',
  '--ask-for-approval', 'never',
  '--cd', cwd,
  ...(model ? ['--model', model] : []),
  'exec',
  '--ephemeral',
  '--ignore-user-config',
  '--color', 'never',
  '--skip-git-repo-check',
  '--output-last-message', outputFile,
  '--output-schema', schemaFile,
  '-',
];

export const askCodex = async ({ executable = 'codex', model, prompt, schema, timeoutMs = 600_000 }: AskOptions): Promise<any> => {
  const cwd = mkdtempSync(join(tmpdir(), 'content-bot-codex-'));
  const outputFile = join(cwd, 'last-message.txt');
  const schemaFile = join(cwd, 'answer-schema.json');
  writeFileSync(schemaFile, `${JSON.stringify(schema, null, 2)}\n`);
  try {
    const { code, stdout, stderr } = await run(executable, codexArgs({ cwd, model, outputFile, schemaFile }), prompt, cwd, timeoutMs);
    if (code !== 0) {
      if (LOGIN_PROBLEM.test(`${stderr} ${stdout}`)) throw new Error(CODEX_NOT_LOGGED_IN);
      throw new Error(`codex exited with ${code}: ${short(stderr || stdout)}`);
    }
    let message = '';
    try { message = readFileSync(outputFile, 'utf8').trim(); } catch { message = ''; }
    if (!message) throw new Error('codex finished without an answer');
    try { return JSON.parse(message); } catch { throw new Error(`codex's answer is not the JSON asked for: ${short(message)}`); }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};
