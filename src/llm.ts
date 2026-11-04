// The language model CLI that answers (RQ-0004): claude (the default) or
// codex, chosen by CONTENT_BOT_LLM. Each gives the bot the same Ask; what
// differs is how it is called (claude.ts, codex.ts), how it reads the copies
// (the prompt says so), its default model and how it logs in.
import { askClaude, NOT_LOGGED_IN, type Ask } from './claude.js';
import { askCodex, CODEX_NOT_LOGGED_IN } from './codex.js';

export const LLM_NAMES = ['claude', 'codex'] as const;
export type LlmName = (typeof LLM_NAMES)[number];

export interface LlmDescription {
  // What the page shows as the provider.
  provider: string;
  // The model when CONTENT_BOT_MODEL is empty; '' leaves it to the CLI.
  defaultModel: string;
  // The variable that names its executable, and the default.
  executableVariable: string;
  defaultExecutable: string;
  // How it reads the copies, for the prompt: "You read the site <reads> (…)".
  reads: string;
  // How to log it in, in the container.
  login: string;
  notLoggedIn: string;
}

export const LLMS: Record<LlmName, LlmDescription> = {
  claude: {
    provider: 'claude-cli (subscription)',
    defaultModel: 'claude-opus-5-5',
    executableVariable: 'CLAUDE_EXECUTABLE',
    defaultExecutable: 'claude',
    reads: 'with Read, Glob and Grep',
    login: 'claude      # /login once, then /exit',
    notLoggedIn: NOT_LOGGED_IN,
  },
  codex: {
    provider: 'codex-cli',
    defaultModel: '',
    executableVariable: 'CODEX_EXECUTABLE',
    defaultExecutable: 'codex',
    reads: 'with read-only shell commands (ls, cat, rg) in a read-only sandbox',
    login: 'codex login --device-auth      # once; the code goes to a browser',
    notLoggedIn: CODEX_NOT_LOGGED_IN,
  },
};

// The LLM a value names; empty is claude; anything else is refused, named.
export const llmOf = (value: string | undefined): LlmName => {
  if (!value) return 'claude';
  if (!LLM_NAMES.includes(value as LlmName)) throw new Error(`CONTENT_BOT_LLM is ${JSON.stringify(value)}; it is one of ${LLM_NAMES.join(', ')}`);
  return value as LlmName;
};

export const makeAsk = ({ llm, executable, model }: { llm: LlmName; executable: string; model: string }): Ask => (prompt, schema, dirs) => (llm === 'codex'
  ? askCodex({ executable, model, prompt, schema, dirs })
  : askClaude({ executable, model, prompt, schema, dirs }));

// A one-line answer, for check: whether the CLI is there and logged in.
export const probe = ({ llm, executable, model }: { llm: LlmName; executable: string; model: string }): Promise<unknown> => {
  const options = { executable, model, prompt: 'Answer with the JSON asked for: ok true.', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, timeoutMs: 120_000 };
  return llm === 'codex' ? askCodex(options) : askClaude(options);
};
