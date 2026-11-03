// The bot changes the site only through edits: each one names a file it may
// change, a piece of that file's current text (`old`) that occurs exactly once
// and the text it becomes (`new`). An edit that matches nowhere or more than
// once stops the change, so a model that misread a file can never write
// somewhere it did not mean to. Which files may change, and how, is the
// config's `editable` list (config.ts).
import type { EditableEntry, Kind } from './config.js';
import { plainPath } from './config.js';
import { checkSvgEdit } from './svg.js';

export interface Edit { file: string; old: string; new: string; where?: string }

// A pattern as a regular expression: * within a segment, ** across segments.
export const globToRegExp = (glob: string): RegExp => {
  const segments = glob.split('/');
  const source = segments.map((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') return last ? '.*' : '(?:[^/]+/)*';
    return `${segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}${last ? '' : '/'}`;
  }).join('');
  return new RegExp(`^${source}$`);
};

const SVG_RULE = 'the text inside <text> and <tspan> elements only: never tags or attributes; "old" and "new" contain no <, > or &';

// The files the bot may change, from the config: which path has which kind,
// and how to describe the rule to the model and to a person.
export class Editable {
  readonly entries: EditableEntry[];
  private readonly matchers: { test: (path: string) => boolean; entry: EditableEntry }[];

  constructor(entries: EditableEntry[]) {
    this.entries = entries;
    this.matchers = entries.map((entry) => ({
      entry,
      test: entry.path !== undefined ? (path: string) => path === entry.path : ((pattern) => (path: string) => pattern.test(path))(globToRegExp(entry.glob!)),
    }));
  }

  entryOf(path: string): EditableEntry | undefined {
    if (typeof path !== 'string' || !plainPath(path)) return undefined;
    return this.matchers.find((matcher) => matcher.test(path))?.entry;
  }

  kindOf(path: string): Kind | undefined {
    return this.entryOf(path)?.kind;
  }

  isEditable(path: string): boolean {
    return this.entryOf(path) !== undefined;
  }

  isSvg(path: string): boolean {
    return this.kindOf(path) === 'svg-text';
  }

  // The list for the prompt's "You may change only:".
  describe(): string {
    return this.entries.map((entry) => {
      const what = entry.path ?? `the .svg drawings matching ${entry.glob}`;
      if (entry.kind === 'svg-text') return `  - ${entry.path ?? `the drawings matching ${entry.glob}`}: ${SVG_RULE};`;
      return `  - ${what}: ${entry.rule ?? 'its text only; never the structure of the file'};`;
    }).join('\n');
  }

  // One line for a refusal: "only X, Y and the text of the drawings matching Z may change".
  summary(): string {
    const texts = this.entries.filter((entry) => entry.kind === 'text').map((entry) => entry.path ?? `files matching ${entry.glob}`);
    const drawings = this.entries.filter((entry) => entry.kind === 'svg-text').map((entry) => entry.path ?? `the drawings matching ${entry.glob}`);
    const parts = [...texts, ...(drawings.length ? [`the text of ${drawings.join(', ')}`] : [])];
    return `only ${parts.join(' and ')} may change`;
  }
}

const count = (text: string, piece: string): number => {
  let found = 0;
  for (let at = text.indexOf(piece); at !== -1; at = text.indexOf(piece, at + 1)) found++;
  return found;
};

const applyOne = (text: string, edit: Partial<Edit> | undefined, label: string): string => {
  if (typeof edit?.old !== 'string' || typeof edit?.new !== 'string') throw new Error(`${label}: old and new must be text`);
  if (edit.old === '') throw new Error(`${label}: old is empty`);
  if (edit.old === edit.new) throw new Error(`${label}: old and new are the same`);
  const found = count(text, edit.old);
  if (found !== 1) throw new Error(`${label}: its old text occurs ${found} times in the file, expected once`);
  return text.replace(edit.old, () => edit.new as string);
};

export const applyEdits = (text: string, edits: { old: string; new: string }[]): string => {
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('no edits');
  return edits.reduce((result, edit, index) => applyOne(result, edit, `edit ${index + 1}`), text);
};

// Applies { file, old, new } edits in order; read(file) gives a file's text.
// Returns a Map of file -> its new text; nothing is written here.
export const applyFileEdits = (read: (file: string) => string, edits: Edit[], editable: Editable): Map<string, string> => {
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('no edits');
  const files = new Map<string, string>();
  edits.forEach((edit, index) => {
    const label = `edit ${index + 1}`;
    if (!editable.isEditable(edit?.file)) throw new Error(`${label}: ${edit?.file || 'its file'} may not be changed; ${editable.summary()}`);
    const text = files.has(edit.file) ? files.get(edit.file)! : read(edit.file);
    const next = applyOne(text, edit, label);
    if (editable.isSvg(edit.file)) checkSvgEdit(text, edit, label);
    files.set(edit.file, next);
  });
  return files;
};
