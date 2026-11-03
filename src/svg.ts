// The text of an SVG drawing: the characters inside its <text> and <tspan>
// elements. The bot may change those and nothing else of a drawing, so an
// edit's old and new are plain text, and the guard compares the drawing with
// every text character removed: equal before and after means only text changed.

const TOKENS = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
const OPEN = /^<(text|tspan)\b[^>]*[^/]>$|^<(text|tspan)>$/;
const CLOSE = /^<\/(text|tspan)\s*>$/;

interface Piece { start: number; end: number; text: boolean }

// The drawing as pieces, each { start, end, text }: text is true for characters
// inside a <text> or <tspan> element.
const pieces = (svg: string): Piece[] => {
  const result: Piece[] = [];
  let depth = 0;
  for (const match of svg.matchAll(TOKENS)) {
    const token = match[0];
    const isTag = token.startsWith('<');
    if (isTag && OPEN.test(token)) depth++;
    else if (isTag && CLOSE.test(token)) depth = Math.max(0, depth - 1);
    result.push({ start: match.index!, end: match.index! + token.length, text: !isTag && depth > 0 });
  }
  return result;
};

export const textless = (svg: string): string => pieces(svg).filter((piece) => !piece.text).map((piece) => svg.slice(piece.start, piece.end)).join('');

export const onlyTextChanged = (before: string, after: string): boolean => textless(before) === textless(after);

// Throws, named, unless the edit is plain text and its old text sits inside a
// <text>/<tspan> element (it cannot span a tag: it has no < or >).
export const checkSvgEdit = (svg: string, edit: { old: string; new: string }, label: string): void => {
  for (const key of ['old', 'new'] as const) {
    if (/[<>&]/.test(edit[key])) throw new Error(`${label}: a drawing's ${key} text may not contain <, > or &`);
  }
  const at = svg.indexOf(edit.old);
  const piece = pieces(svg).find((entry) => entry.start <= at && at < entry.end);
  if (at === -1 || !piece?.text) throw new Error(`${label}: its old text is not inside a <text> or <tspan> element of the drawing`);
};
