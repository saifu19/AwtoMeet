import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InsightsColumn } from '../InsightsColumn';
import type { AgentOutputSchema } from '@meeting-app/shared';

const MEETING_ID = '01JA0000000000000000000001';
const AGENT_A = { id: '01AGENT_A0000000000000001', name: 'Sales Coach' };
const AGENT_B = { id: '01AGENT_B0000000000000002', name: 'Note Taker' };

// Mock the useMeetingAgents hook
vi.mock('@/features/meetings/insights-hooks', () => ({
  useMeetingAgents: vi.fn(),
}));

import { useMeetingAgents } from '@/features/meetings/insights-hooks';
const mockUseMeetingAgents = vi.mocked(useMeetingAgents);

function makeOutput(
  agentId: string,
  id: number,
  content = 'Test output',
): AgentOutputSchema {
  return {
    id,
    agent_run_id: 100 + id,
    meeting_id: MEETING_ID,
    agent_id: agentId,
    agent_name: agentId === AGENT_A.id ? AGENT_A.name : AGENT_B.name,
    content,
    metadata: null,
    created_at: `2026-04-13T12:0${id}:00.000Z`,
  } as AgentOutputSchema;
}

describe('InsightsColumn', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockUseMeetingAgents.mockReturnValue({
      data: [AGENT_A, AGENT_B],
      isLoading: false,
    } as unknown as ReturnType<typeof useMeetingAgents>);
  });

  it('renders tabs for each agent', () => {
    render(<InsightsColumn meetingId={MEETING_ID} outputs={[]} />);
    expect(screen.getByText('Sales Coach')).toBeInTheDocument();
    expect(screen.getByText('Note Taker')).toBeInTheDocument();
  });

  it('shows empty state when no agents are attached', () => {
    mockUseMeetingAgents.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useMeetingAgents>);
    render(<InsightsColumn meetingId={MEETING_ID} outputs={[]} />);
    expect(screen.getByText(/no agents attached/i)).toBeInTheDocument();
  });

  it('shows loading spinner when agents are loading', () => {
    mockUseMeetingAgents.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useMeetingAgents>);
    const { container } = render(
      <InsightsColumn meetingId={MEETING_ID} outputs={[]} />,
    );
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('groups outputs by agent into the correct tab', () => {
    const outputs = [
      makeOutput(AGENT_A.id, 1, 'Insight from A'),
      makeOutput(AGENT_B.id, 2, 'Insight from B'),
    ];
    render(<InsightsColumn meetingId={MEETING_ID} outputs={outputs} />);
    // Default tab is AGENT_A — should show A's output
    expect(screen.getByText('Insight from A')).toBeInTheDocument();
  });

  // --- sessionStorage persistence tests ---

  it('persists selected tab to sessionStorage', async () => {
    const user = userEvent.setup();
    render(<InsightsColumn meetingId={MEETING_ID} outputs={[]} />);

    // Click the second tab
    await user.click(screen.getByText('Note Taker'));

    expect(sessionStorage.getItem(`insights-tab-${MEETING_ID}`)).toBe(
      AGENT_B.id,
    );
  });

  it('restores selected tab from sessionStorage on mount', () => {
    sessionStorage.setItem(`insights-tab-${MEETING_ID}`, AGENT_B.id);
    const outputs = [
      makeOutput(AGENT_A.id, 1, 'Insight A'),
      makeOutput(AGENT_B.id, 2, 'Insight B'),
    ];
    render(<InsightsColumn meetingId={MEETING_ID} outputs={outputs} />);
    // AGENT_B tab should be active, showing its output
    expect(screen.getByText('Insight B')).toBeInTheDocument();
  });

  it('falls back to first agent when stored tab ID is stale', () => {
    sessionStorage.setItem(`insights-tab-${MEETING_ID}`, 'STALE_AGENT_ID');
    const outputs = [makeOutput(AGENT_A.id, 1, 'Insight A')];
    render(<InsightsColumn meetingId={MEETING_ID} outputs={outputs} />);
    // Should fall back to AGENT_A (first) and show its output
    expect(screen.getByText('Insight A')).toBeInTheDocument();
    // sessionStorage should be updated to the fallback
    expect(sessionStorage.getItem(`insights-tab-${MEETING_ID}`)).toBe(
      AGENT_A.id,
    );
  });

  it('shows listening state when active tab has no outputs yet', () => {
    render(<InsightsColumn meetingId={MEETING_ID} outputs={[]} />);
    expect(screen.getByText(/listening/i)).toBeInTheDocument();
  });
});
