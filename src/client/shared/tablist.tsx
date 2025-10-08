import { cn } from '../utils/cn';

type TablistItem = { name: string };

type TablistProps = {
  activeIndex: number;
  onChange: (index: number) => void;
  items: TablistItem[];
};

export const Tablist = ({ activeIndex, onChange, items }: TablistProps) => {
  const handleKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onChange(index);
    }
  };

  return (
    <div role="tablist" className="flex flex-wrap justify-center">
      {items.map((item, index) => (
        <button
          key={item.name}
          role="tab"
          aria-selected={activeIndex === index}
          tabIndex={0}
          onClick={() => onChange(index)}
          onKeyDown={(e: unknown) => handleKeyDown(e as KeyboardEvent, index)}
          className={cn(
            'border-b-2 px-2 py-2 text-sm font-medium outline-none transition-colors duration-200 ease-in-out md:px-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:focus-visible:ring-slate-400 bg-transparent',
            activeIndex === index
              ? 'border-current text-slate-900 dark:text-white'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          )}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
};

export type { TablistProps, TablistItem };
