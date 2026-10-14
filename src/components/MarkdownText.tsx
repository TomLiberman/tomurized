import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 【מקור: file】 / 【ידע כללי — לאמת】 citation markers emitted by the course chat.
const CITE_RE = /【([^】]+)】/g;

// Small numbered footnote ornament; the source appears on hover (desktop) or
// tap (mobile — tapping focuses the button, focus-within shows the tooltip).
function Cite({ n, source }: { n: number; source: string }) {
  return (
    <sup className="chat-cite">
      <button type="button" className="chat-cite-btn" aria-label={source}>
        {n}
      </button>
      <span className="chat-cite-tip" role="tooltip">
        {source}
      </span>
    </sup>
  );
}

// Renders AI-generated Markdown (bold, lists, headings, tables) as styled HTML.
// With `withCitations`, 【...】 markers collapse into numbered hover ornaments
// (same source → same number). Implemented by rewriting each marker to a
// markdown link on a #cite- anchor, then rendering those links as <Cite> —
// links are inline nodes, so text flow and block structure stay intact.
export default function MarkdownText({ children, withCitations = false }: { children: string; withCitations?: boolean }) {
  let text = children;
  let components: Components | undefined;

  if (withCitations) {
    const numbers = new Map<string, number>();
    text = children.replace(CITE_RE, (_, src: string) => {
      const key = src.trim();
      if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
      return `[${numbers.get(key)}](#cite-${encodeURIComponent(key)})`;
    });
    components = {
      a: ({ href, children: linkChildren }: { href?: string; children?: ReactNode }) => {
        if (href?.startsWith('#cite-')) {
          const source = decodeURIComponent(href.slice('#cite-'.length));
          const label = Array.isArray(linkChildren) ? linkChildren.join('') : String(linkChildren ?? '');
          const n = Number(label);
          if (Number.isFinite(n)) return <Cite n={n} source={source} />;
        }
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {linkChildren}
          </a>
        );
      },
    };
  }

  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
