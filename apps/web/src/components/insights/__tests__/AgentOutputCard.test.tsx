import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentOutputCard } from '../AgentOutputCard';
import type { AgentOutputSchema } from '@meeting-app/shared';

function makeOutput(
  overrides: Partial<AgentOutputSchema> = {},
): AgentOutputSchema {
  return {
    id: 1,
    agent_run_id: 10,
    meeting_id: '01JA0000000000000000000001',
    agent_id: '01JA0000000000000000000002',
    agent_name: 'Test Agent',
    content: 'Hello world',
    metadata: null,
    created_at: '2026-04-13T12:00:00.000Z',
    ...overrides,
  } as AgentOutputSchema;
}

describe('AgentOutputCard', () => {
  it('renders agent name and markdown content', () => {
    render(<AgentOutputCard output={makeOutput({ content: '**bold text**' })} />);
    expect(screen.getByText('Test Agent')).toBeInTheDocument();
    expect(screen.getByText('bold text')).toBeInTheDocument();
  });

  it('renders GFM tables via remark-gfm', () => {
    const tableMarkdown = '| Col A | Col B |\n|---|---|\n| 1 | 2 |';
    const { container } = render(
      <AgentOutputCard output={makeOutput({ content: tableMarkdown })} />,
    );
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelector('th')).toHaveTextContent('Col A');
    expect(container.querySelector('td')).toHaveTextContent('1');
  });

  it('renders GFM strikethrough via remark-gfm', () => {
    const { container } = render(
      <AgentOutputCard output={makeOutput({ content: '~~deleted~~' })} />,
    );
    expect(container.querySelector('del')).toHaveTextContent('deleted');
  });

  it('renders GFM task lists via remark-gfm', () => {
    const taskMarkdown = '- [x] Done\n- [ ] Pending';
    const { container } = render(
      <AgentOutputCard output={makeOutput({ content: taskMarkdown })} />,
    );
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('renders headings, code blocks, and blockquotes', () => {
    const md = '# Title\n\n`inline code`\n\n> Quote';
    const { container } = render(
      <AgentOutputCard output={makeOutput({ content: md })} />,
    );
    expect(container.querySelector('h1')).toHaveTextContent('Title');
    expect(container.querySelector('code')).toHaveTextContent('inline code');
    expect(container.querySelector('blockquote')).toBeInTheDocument();
  });
});
