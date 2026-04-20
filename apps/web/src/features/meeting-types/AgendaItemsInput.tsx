import { useState, type KeyboardEvent } from 'react';
import { XIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface AgendaItemsInputProps {
  value: string[];
  onChange: (items: string[]) => void;
}

export function AgendaItemsInput({ value, onChange }: AgendaItemsInputProps) {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed]);
      }
      setInput('');
    }
    // Remove last item on Backspace when input is empty
    if (e.key === 'Backspace' && input === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <Badge
              key={index}
              variant="secondary"
              className="gap-1 pr-1 text-xs"
            >
              {item}
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type an agenda item and press Enter"
      />
    </div>
  );
}
