export interface BulletEdit {
  start: number; end: number; text: string; selectionStart: number; selectionEnd: number;
}
const bullet = /^([ \t]*)[-*+] /;
const outdentLength = (indent: string) => indent.startsWith('\t') ? 1 : Math.min(4, indent.match(/^ */)![0].length);
function replace(start: number, end: number, text: string): BulletEdit {
  return { start, end, text, selectionStart: start + text.length, selectionEnd: start + text.length };
}

/** Text-only edits keep browser and unit tests on the same selection semantics. */
export function enableBullets(value: string, start: number, end: number): BulletEdit | undefined {
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(lineStart).split('\n')[0]!;
  if (bullet.test(line)) return;
  const insert = lineStart + line.match(/^[ \t]*/)![0].length;
  return { start: insert, end: insert, text: '- ', selectionStart: start >= insert ? start + 2 : start, selectionEnd: end >= insert ? end + 2 : end };
}

export function bulletKeyEdit(value: string, start: number, end: number, key: string, shift = false): BulletEdit | undefined {
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', start);
  const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
  const match = line.match(bullet);
  if (key === 'Tab') {
    // A selection ending at the next line's start doesn't include that line.
    const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const endOfLine = value.indexOf('\n', last);
    const blockEnd = endOfLine < 0 ? value.length : endOfLine;
    let position = lineStart;
    const changes: { position: number; removed: number; added: number }[] = [];
    const text = value.slice(lineStart, blockEnd).split('\n').map((part) => {
      const removed = shift ? outdentLength(part.match(/^[ \t]*/)![0]) : 0;
      changes.push({ position, removed, added: shift ? 0 : 4 });
      position += part.length + 1;
      return shift ? part.slice(removed) : `    ${part}`;
    }).join('\n');
    const map = (offset: number) => offset + changes.reduce((delta, change) => delta + (offset >= change.position ? change.added - Math.min(change.removed, offset - change.position) : 0), 0);
    return { start: lineStart, end: blockEnd, text, selectionStart: map(start), selectionEnd: map(end) };
  }
  if (key === 'Backspace') {
    if (start !== end || !match || line.trim() !== match[0].trim() || start !== lineStart + line.length) return;
    const indent = match[1]!;
    if (indent.length) {
      const removed = outdentLength(indent);
      return { start: lineStart, end: lineStart + removed, text: '', selectionStart: start - removed, selectionEnd: end - removed };
    }
    return { start, end, text: '', selectionStart: start, selectionEnd: end };
  }
  if (key !== 'Enter') return;
  let indent = match?.[1];
  // Shift+Enter continuation lines inherit the nearest containing item.
  if (indent === undefined) {
    const leading = line.match(/^[ \t]*/)![0].length;
    const preceding = value.slice(0, Math.max(0, lineStart - 1)).split('\n');
    for (let index = preceding.length - 1; index >= 0; index--) {
      const previous = preceding[index]!;
      const parent = previous.match(bullet);
      if (parent && leading >= parent[0].length) { indent = parent[1]; break; }
      if (previous.trim() && previous.match(/^[ \t]*/)![0].length < leading) break;
    }
  }
  if (indent === undefined || start < lineStart + (match?.[0].length ?? 0)) return;
  return replace(start, end, `\n${indent}${shift ? '  ' : '- '}`);
}
