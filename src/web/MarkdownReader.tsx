import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import GithubSlugger from 'github-slugger';
import { readerMarkdown } from '../shared/citations';
import type { Citation } from '../shared/api';
import 'katex/dist/katex.min.css';

let diagramNumber = 0;
function Diagram({ source, onLayout }: { source: string; onLayout: () => void }) {
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', suppressErrorRendering: true,
        flowchart: { htmlLabels: false } });
      const result = await mermaid.render(`crypto-diagram-${++diagramNumber}`, source.replace(/<br\s*\/?>/gi, '\n'));
      if (!disposed) setSvg(result.svg);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [source]);
  useEffect(() => { if (svg || error) onLayout(); }, [svg, error, onLayout]);
  if (error) return <div><p role="status">Diagramm konnte nicht dargestellt werden.</p><pre><code>{source}</code></pre></div>;
  return svg ? <div className="mermaid-diagram" role="img" aria-label="Lerndiagramm" dangerouslySetInnerHTML={{ __html: svg }} /> : <pre aria-label="Diagramm wird geladen">{source}</pre>;
}

const schema = { ...defaultSchema, tagNames: [...defaultSchema.tagNames ?? [], 'details', 'summary'],
  attributes: { ...defaultSchema.attributes, code: [...defaultSchema.attributes?.code ?? [], ['className', /^language-./, 'math-inline', 'math-display']],
    details: ['open'] } };

export const MarkdownReader = memo(function MarkdownReader({ markdown, citations, onCitation, onLayout }: {
  markdown: string; citations: Citation[]; onCitation: (citation: Citation) => void; onLayout: () => void;
}) {
  const content = useMemo(() => readerMarkdown(markdown), [markdown]);
  const root = useRef<HTMLDivElement>(null);
  const citationMap = useMemo(() => new Map(citations.map((c) => [c.id, c])), [citations]);
  return <div ref={root} className="markdown-content"><Markdown remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], [rehypeKatex, { throwOnError: false, trust: false, maxExpand: 1000, maxSize: 20 }], headingIds]}
    components={{
      a: ({ href, children }) => {
        const id = href?.startsWith('#citation-') ? href.slice('#citation-'.length) : undefined;
        if (id) {
          const citation = citationMap.get(id);
          return <button type="button" className={`citation-link${citation?.error ? ' citation-invalid' : ''}`} title={citation?.error ?? `Quelle ${id.slice(4)} öffnen`}
            onClick={() => onCitation(citation ?? { id, error: 'Quelle konnte nicht aufgelöst werden.' })}>{children}</button>;
        }
        if (href?.startsWith('#')) return <a href={href} onClick={(event) => {
          event.preventDefault();
          let target: string; try { target = decodeURIComponent(href.slice(1)); } catch { return; }
          const heading = [...root.current?.querySelectorAll('[id]') ?? []].find((node) => node.id === target);
          heading?.scrollIntoView({ block: 'start' });
        }}>{children}</a>;
        if (href && /^https?:\/\//i.test(href)) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
        return <span title="Lokaler Link ist keine registrierte Quelle.">{children}</span>;
      },
      code: ({ className, children, ...props }) => className === 'language-mermaid'
        ? <Diagram source={String(children).replace(/\n$/, '')} onLayout={onLayout} />
        : <code className={className} {...props}>{children}</code>,
      img: ({ alt }) => <span>{alt ? `[Bild: ${alt}]` : '[Bild]'}</span>,
    }}>{content}</Markdown></div>;
});

/** IDs must match the anchors already present in the imported learning scripts. */
function headingIds() {
  return (tree: { children?: unknown[] }) => {
    const slugger = new GithubSlugger();
    type Node = { type?: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };
    const text = (node: Node): string => node.value ?? node.children?.map(text).join('') ?? '';
    const walk = (node: Node) => {
      if (/^h[1-6]$/.test(node.tagName ?? '')) node.properties = { ...node.properties, id: slugger.slug(text(node)) };
      node.children?.forEach(walk);
    };
    walk(tree as Node);
  };
}
