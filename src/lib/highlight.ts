// Split `text` around case-insensitive occurrences of a user-typed search query.
// The query is escaped: it's plain text, not a regex — "(" or "[" used to throw
// "Invalid regular expression" mid-render and take the whole app down.

export interface HighlightPart {
  text: string;
  match: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function splitHighlight(text: string, query: string): HighlightPart[] {
  if (!query) return [{ text, match: false }];
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
  const q = query.toLowerCase();
  return parts.filter(Boolean).map((part) => ({ text: part, match: part.toLowerCase() === q }));
}
