import { branchTitle, lineage } from './threads.js';

const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
const termsFor = (query) => [...new Set(fold(query.trim()).split(/\s+/).filter(Boolean))];

// Keep offsets into the original string so accents and emoji remain intact in highlights.
function matchingRanges(text, terms) {
  let normalized = '';
  const offsets = [];
  let offset = 0;
  for (const character of text) {
    const value = fold(character);
    normalized += value;
    for (let index = 0; index < value.length; index++) offsets.push([offset, offset + character.length]);
    if (!value && offsets.length) offsets.at(-1)[1] = offset + character.length;
    offset += character.length;
  }
  const ranges = [];
  for (const term of terms) {
    let index = normalized.indexOf(term);
    while (index !== -1) {
      ranges.push([offsets[index][0], offsets[index + term.length - 1][1]]);
      index = normalized.indexOf(term, index + term.length);
    }
  }
  const merged = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0])) {
    if (merged.length && range[0] <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

export function searchExcerpt(text, query, length = 180) {
  const ranges = matchingRanges(text, termsFor(query));
  let start = Math.max(0, (ranges[0]?.[0] ?? 0) - 55);
  if (start && /[\uDC00-\uDFFF]/.test(text[start])) start--;
  let end = Math.min(text.length, start + length);
  if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  const parts = [];
  let cursor = start;
  if (start) parts.push({ text: '…', match: false });
  for (const [from, to] of ranges) {
    if (to <= start || from >= end) continue;
    if (from > cursor) parts.push({ text: text.slice(cursor, from), match: false });
    parts.push({ text: text.slice(Math.max(start, from), Math.min(end, to)), match: true });
    cursor = Math.min(end, to);
  }
  if (cursor < end) parts.push({ text: text.slice(cursor, end), match: false });
  if (end < text.length) parts.push({ text: '…', match: false });
  return parts;
}

export function searchConversations(threads, query) {
  const terms = termsFor(query);
  const includes = (text) => { const value = fold(text); return terms.every((term) => value.includes(term)); };
  const results = [];
  for (const thread of [...threads].filter((item) => !item.temporary && item.branches[item.rootId].messages.length).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    for (const branch of Object.values(thread.branches)) {
      const root = branch.id === thread.rootId;
      if (!terms.length && !root) continue;
      // Search own messages only: inherited messages belong to their original branch.
      const matches = terms.length ? branch.messages.filter((entry) => includes(entry.content)) : [];
      const titleMatch = terms.length && includes(root ? thread.title : branchTitle(branch));
      if (terms.length && !matches.length && !titleMatch) continue;
      const first = matches[0];
      results.push({
        threadId: thread.id, threadTitle: thread.title, branchId: branch.id,
        branchTitle: root ? 'Rama principal' : branchTitle(branch),
        path: lineage(thread, branch.id).map((item) => item.id === thread.rootId ? 'Principal' : branchTitle(item)),
        messageId: first?.id ?? null, messageCount: matches.length,
        excerpt: searchExcerpt(first?.content || branch.messages[0]?.content || thread.title, query),
      });
    }
  }
  return results;
}
