// One answer from the signed-in `claude` CLI (the subscription, no API key): the
// prompt on stdin, in a throwaway working directory so no project CLAUDE.md or
// AGENTS.md is read as instructions, no permission prompts. It may read, never
// write: Read, Glob and Grep are allowed in the directories it is given
// (--add-dir), every other tool is denied. The JSON envelope says whether it
// worked, whatever the exit code: a run that is not logged in exits 1 with
// "Not logged in" in it.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];
export const DENIED_TOOLS = [
  'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch',
  'Task', 'NotebookEdit', 'TodoWrite', 'Artifact', 'Skill',
];

export const NOT_LOGGED_IN = 'Claude is not logged in in the container: run `claude` in it (docker exec -it <container> claude) and `/login` there.';
const LOGIN_PROBLEM = /not logged in|\/login|oauth|authenticat|credential/i;

interface Run { code: number | null; stdout: string; stderr: string }

const run = (executable: string, args: string[], stdin: string, cwd: string, timeoutMs: number): Promise<Run> => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => { clearTimeout(timer); reject(new Error(`claude could not be started: ${error.message}`)); });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (signal === 'SIGKILL') return reject(new Error(`claude did not answer within ${Math.round(timeoutMs / 1000)} s`));
    resolve({ code, stdout, stderr });
  });
  child.stdin.end(stdin);
});

const short = (text: unknown): string => String(text).replace(/\s+/g, ' ').trim().slice(0, 300);

export interface AskOptions {
  executable?: string;
  // Empty: the CLI's own default (codex); claude always gets one.
  model: string;
  prompt: string;
  schema: unknown;
  // The read-only directories it may read (absolute paths).
  dirs?: string[];
  timeoutMs?: number;
}

export type Ask = (prompt: string, schema: unknown, dirs: string[]) => Promise<any>;

export const askClaude = async ({ executable = 'claude', model, prompt, schema, dirs = [], timeoutMs = 600_000 }: AskOptions): Promise<any> => {
  const args = [
    '--print',
    '--output-format', 'json',
    '--model', model,
    '--permission-prompts', 'none',
    '--allowedTools', ALLOWED_TOOLS.join(' '),
    '--disallowedTools', DENIED_TOOLS.join(' '),
    ...(dirs.length ? ['--add-dir', ...dirs] : []),
    '--json-schema', JSON.stringify(schema),
  ];
  const cwd = mkdtempSync(join(tmpdir(), 'content-bot-claude-'));
  try {
    const { code, stdout, stderr } = await run(executable, args, prompt, cwd, timeoutMs);
    let envelope: any;
    try { envelope = JSON.parse(stdout); } catch { envelope = undefined; }
    if (!envelope || typeof envelope !== 'object') {
      if (LOGIN_PROBLEM.test(`${stdout} ${stderr}`)) throw new Error(NOT_LOGGED_IN);
      throw new Error(code === 0 ? `claude did not answer JSON: ${short(stdout)}` : `claude exited with ${code}: ${short(stderr || stdout)}`);
    }
    if (envelope.is_error === true || code !== 0) {
      const said = String(envelope.result ?? envelope.error ?? stderr ?? 'error');
      throw new Error(LOGIN_PROBLEM.test(said) ? NOT_LOGGED_IN : `claude: ${short(said)}`);
    }
    if (envelope.structured_output && typeof envelope.structured_output === 'object') return envelope.structured_output;
    try { return JSON.parse(String(envelope.result ?? '').trim()); } catch { throw new Error(`claude's answer is not the JSON asked for: ${short(envelope.result)}`); }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};
