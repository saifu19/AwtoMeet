import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const remarkPlugins = [remarkGfm];

export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-semibold mt-3 mb-1">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>
  ),
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="rounded-md bg-muted p-3 overflow-x-auto text-xs font-mono">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <table className="w-full border-collapse text-sm my-2">{children}</table>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left font-medium px-2 py-1 text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 border-t border-border/50">{children}</td>
  ),
  del: ({ children }) => (
    <del className="line-through text-muted-foreground">{children}</del>
  ),
  input: ({ checked, ...props }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled
      className="mr-1.5"
      {...props}
    />
  ),
};
