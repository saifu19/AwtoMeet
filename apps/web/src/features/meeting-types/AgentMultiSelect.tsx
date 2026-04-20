import { useState } from 'react';
import { CheckIcon, ChevronsUpDownIcon, BotIcon } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { useAgents } from '@/features/agents/hooks';

interface AgentMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

export function AgentMultiSelect({ value, onChange }: AgentMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const { data: agents, isLoading } = useAgents();

  const toggle = (agentId: string) => {
    if (value.includes(agentId)) {
      onChange(value.filter((id) => id !== agentId));
    } else {
      onChange([...value, agentId]);
    }
  };

  const selectedAgents = (agents ?? []).filter((a) => value.includes(a.id));

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
        >
          <span className="truncate text-sm">
            {value.length === 0
              ? 'Select agents...'
              : `${value.length} agent${value.length === 1 ? '' : 's'} selected`}
          </span>
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search agents..." />
            <CommandList>
              <CommandEmpty>
                {isLoading ? 'Loading agents...' : 'No agents found.'}
              </CommandEmpty>
              <CommandGroup>
                {(agents ?? []).map((agent) => {
                  const isSelected = value.includes(agent.id);
                  return (
                    <CommandItem
                      key={agent.id}
                      value={agent.name}
                      onSelect={() => toggle(agent.id)}
                      className="cursor-pointer"
                    >
                      <div
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/30'
                        }`}
                      >
                        {isSelected && <CheckIcon className="h-3 w-3" />}
                      </div>
                      <BotIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{agent.name}</span>
                      {agent.provider && (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {agent.provider}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedAgents.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedAgents.map((agent) => (
            <Badge
              key={agent.id}
              variant="secondary"
              className="gap-1 pr-1 text-xs"
            >
              <BotIcon className="h-3 w-3" />
              {agent.name}
              <button
                type="button"
                onClick={() => toggle(agent.id)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              >
                <span className="sr-only">Remove {agent.name}</span>
                <span className="h-3 w-3 text-xs leading-none">&times;</span>
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
