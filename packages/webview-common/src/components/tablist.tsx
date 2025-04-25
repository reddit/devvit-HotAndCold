import { KeyboardEvent } from 'react';
import { cn } from '@hotandcold/webview-common/utils';

interface TablistProps {
  activeIndex: number;
  onChange: (index: number) => void;
  items: Array<{ name: string }>;
}

export const Tablist = ({ activeIndex, onChange, items }: TablistProps) => {
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'Enter') {
      onChange(index);
    }
  };

  return (
    <div role="tablist" className="inline-flex text-gray-600 dark:text-gray-400">
      {items.map((item, index) => (
        <button
          key={item.name}
          role="tab"
          aria-selected={activeIndex === index}
          tabIndex={0}
          onClick={() => onChange(index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className={cn(
            `border-b px-3 py-2 text-sm font-medium outline-none ring-0 transition-colors duration-200 ease-in-out md:px-6`,
            activeIndex === index
              ? 'border-current text-black dark:text-white'
              : 'border-gray-200 hover:border-current hover:text-slate-300 dark:border-gray-800'
          )}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
};
