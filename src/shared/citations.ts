import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

/** Normalize only the render copy. CommonMark otherwise rejects spaces in <PDF paths>. */
export function normalizeMarkdown(markdown: string): string {
  let fence: string | undefined;
  return markdown.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return line;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    const definition = /^( {0,3}\[[^\]]+\]:\s*)<([^>]+)>(.*)$/.exec(line);
    if (definition) return `${definition[1]}<${definition[2]!.replace(/ /g, '%20')}>${definition[3]}`;
    return line.replace(/\\\[/g, '\n$$$$\n').replace(/\\\]/g, '\n$$$$\n').replace(/\\\(/g, '$').replace(/\\\)/g, '$');
  }).join('\n');
}

interface Node { type: string; identifier?: string; url?: string; value?: string; children?: Node[] }
export function citationReferences(markdown: string): { markdown: string; definitions: Map<string, string>; used: Set<string>; warnings: string[] } {
  const normalized = normalizeMarkdown(markdown);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(normalized) as Node;
  const definitions = new Map<string, string>();
  const used = new Set<string>();
  const warnings: string[] = [];
  const walk = (node: Node) => {
    if (node.type === 'code' || node.type === 'inlineCode') return;
    if (node.type === 'definition' && /^src-\d+$/i.test(node.identifier ?? '')) {
      const id = node.identifier!.toLowerCase();
      if (definitions.has(id)) warnings.push(`Quellen-ID ${id} ist mehrfach definiert.`);
      else definitions.set(id, node.url!);
    }
    if (node.type === 'linkReference' && /^src-\d+$/i.test(node.identifier ?? '')) used.add(node.identifier!.toLowerCase());
    if (node.type === 'text') for (const match of (node.value ?? '').matchAll(/\[[^\]\n]+\]\[(src-\d+)\]/gi)) used.add(match[1]!.toLowerCase());
    node.children?.forEach(walk);
  };
  walk(tree);
  return { markdown: normalized, definitions, used, warnings };
}

/** All numbered citations become app-local links, including unresolved references. */
export function readerMarkdown(markdown: string): string {
  const parsed = citationReferences(markdown);
  let fence: string | undefined;
  const lines = parsed.markdown.split('\n').map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined; return line; }
    if (fence) return line;
    return line.replace(/^( {0,3}\[(src-\d+)\]:).*$/i, (_, prefix: string, id: string) => `${prefix} #citation-${id.toLowerCase()}`);
  });
  for (const id of parsed.used) if (!parsed.definitions.has(id)) lines.push(`[${id}]: #citation-${id}`);
  return lines.join('\n');
}
