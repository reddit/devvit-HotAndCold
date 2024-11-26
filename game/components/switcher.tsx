import { KeyboardEvent } from 'react';
import { cn } from '../utils';

interface PillSwitchProps {
  activeIndex: number;
  onChange: (index: number) => void;
  items: Array<{ name: string }>;
}

export const PillSwitch = ({ activeIndex, onChange, items }: PillSwitchProps) => {
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'Enter') {
      onChange(index);
    }
  };

  return (
    <div role="tablist" className="inline-flex rounded-lg p-1">
      {items.map((item, index) => (
        <button
          key={item.name}
          role="tab"
          aria-selected={activeIndex === index}
          tabIndex={0}
          onClick={() => onChange(index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className={cn(
            `rounded-md px-4 py-2 text-sm font-medium outline-none ring-0 transition-all duration-200 ease-in-out`,
            activeIndex === index ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-slate-300'
          )}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
};

export default PillSwitch;
