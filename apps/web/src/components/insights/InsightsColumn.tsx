import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentOutputSchema } from '@meeting-app/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMeetingAgents } from '@/features/meetings/insights-hooks';
import { AgentOutputCard } from './AgentOutputCard';

interface InsightsColumnProps {
  meetingId: string;
  outputs: AgentOutputSchema[];
}

// Distinct accent colors per agent tab — matches the dot + stripe on each card.
const AGENT_COLORS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-emerald-500',
  'bg-fuchsia-500',
  'bg-cyan-500',
  'bg-lime-500',
];

const AGENT_TAB_RING = [
  'data-[state=active]:text-violet-600 dark:data-[state=active]:text-violet-400',
  'data-[state=active]:text-sky-600 dark:data-[state=active]:text-sky-400',
  'data-[state=active]:text-amber-600 dark:data-[state=active]:text-amber-400',
  'data-[state=active]:text-rose-600 dark:data-[state=active]:text-rose-400',
  'data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400',
  'data-[state=active]:text-fuchsia-600 dark:data-[state=active]:text-fuchsia-400',
  'data-[state=active]:text-cyan-600 dark:data-[state=active]:text-cyan-400',
  'data-[state=active]:text-lime-600 dark:data-[state=active]:text-lime-400',
];

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <div className="mx-auto h-8 w-8 rounded-full bg-muted flex items-center justify-center">
          <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">
          No agents attached to this meeting.
        </p>
      </div>
    </div>
  );
}

function TabEmpty() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <div className="mx-auto flex h-6 w-6 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          Listening... speak a few sentences to see insights.
        </p>
      </div>
    </div>
  );
}

const STICKY_THRESHOLD_PX = 100;

export function InsightsColumn({ meetingId, outputs }: InsightsColumnProps) {
  const { data: agents, isLoading } = useMeetingAgents(meetingId);

  const outputsByAgent = useMemo(() => {
    const map = new Map<string, AgentOutputSchema[]>();
    for (const output of outputs) {
      const arr = map.get(output.agent_id) ?? [];
      arr.push(output);
      map.set(output.agent_id, arr);
    }
    return map;
  }, [outputs]);

  // --- Gap 2: sessionStorage tab persistence ---
  const storageKey = `insights-tab-${meetingId}`;
  const firstAgentId = agents?.[0]?.id ?? '';

  const [activeTab, setActiveTab] = useState<string>(() => {
    const stored = sessionStorage.getItem(storageKey);
    return stored ?? firstAgentId;
  });

  // Validate activeTab when agents load or change
  useEffect(() => {
    if (!agents || agents.length === 0) return;
    if (!agents.some((a) => a.id === activeTab)) {
      const fallback = agents[0]!.id;
      setActiveTab(fallback);
      sessionStorage.setItem(storageKey, fallback);
    }
  }, [agents, activeTab, storageKey]);

  const handleTabChange = useCallback(
    (value: string | number | null) => {
      if (value == null) return;
      const v = String(value);
      setActiveTab(v);
      sessionStorage.setItem(storageKey, v);
    },
    [storageKey],
  );

  // --- Gap 3: auto-scroll in active tab ---
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottomRef = useRef(true);

  // Track whether user is near the bottom on every render
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distanceFromBottom < STICKY_THRESHOLD_PX;
  });

  // Scroll to bottom when new outputs arrive (if was already at bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [outputs.length]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!agents || agents.length === 0) {
    return <EmptyState />;
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col gap-0 p-4">
      <TabsList className="self-start mb-3 bg-muted/50">
        {agents.map((agent, idx) => (
          <TabsTrigger
            key={agent.id}
            value={agent.id}
            className={`gap-1.5 ${AGENT_TAB_RING[idx % AGENT_TAB_RING.length]}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${AGENT_COLORS[idx % AGENT_COLORS.length]}`}
            />
            {agent.name}
          </TabsTrigger>
        ))}
      </TabsList>
      {agents.map((agent, idx) => {
        const agentOutputs = outputsByAgent.get(agent.id) ?? [];
        const accentColor = AGENT_COLORS[idx % AGENT_COLORS.length]!;
        return (
          <TabsContent
            key={agent.id}
            value={agent.id}
            ref={agent.id === activeTab ? scrollRef : undefined}
            className="flex-1 min-h-0 overflow-y-auto space-y-3"
          >
            {agentOutputs.length === 0 ? (
              <TabEmpty />
            ) : (
              agentOutputs.map((output) => (
                <AgentOutputCard
                  key={output.id}
                  output={output}
                  accentColor={accentColor}
                />
              ))
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
