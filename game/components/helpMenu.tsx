import { useState, useRef, useEffect } from 'react';

export const HelpMenu = ({
  items,
}: {
  items: { name: string; action: () => void | Promise<void>; disabled?: boolean }[];
}) => {
  const [toggled, setToggled] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Handle outside clicks
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setToggled(false);
      }
    };

    if (toggled) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [toggled]);

  // Auto-focus first non-disabled item when menu opens
  useEffect(() => {
    if (toggled) {
      const firstEnabledIndex = items.findIndex((item) => !item.disabled);
      if (firstEnabledIndex !== -1) {
        buttonRefs.current[firstEnabledIndex]?.focus();
        setFocusIndex(firstEnabledIndex);
      }
    }
  }, [toggled, items]);

  const findNextEnabledIndex = (currentIndex: number, direction: 'next' | 'prev') => {
    let index = currentIndex;
    const increment = direction === 'next' ? 1 : -1;

    do {
      index = (index + increment + items.length) % items.length;
    } while (items[index].disabled && index !== currentIndex);

    return items[index].disabled ? currentIndex : index;
  };

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!toggled) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        const nextDownIndex = findNextEnabledIndex(focusIndex, 'next');
        buttonRefs.current[nextDownIndex]?.focus();
        setFocusIndex(nextDownIndex);
        break;
      case 'ArrowUp':
        event.preventDefault();
        const nextUpIndex = findNextEnabledIndex(focusIndex, 'prev');
        buttonRefs.current[nextUpIndex]?.focus();
        setFocusIndex(nextUpIndex);
        break;
      case 'Tab':
        event.preventDefault();
        const nextTabIndex = findNextEnabledIndex(focusIndex, 'next');
        buttonRefs.current[nextTabIndex]?.focus();
        setFocusIndex(nextTabIndex);
        break;
      case 'Enter':
        event.preventDefault();
        const currentButton = buttonRefs.current[focusIndex];
        if (currentButton && !items[focusIndex].disabled) {
          handleItemClick(items[focusIndex].action, items[focusIndex].disabled);
        }
        break;
      case 'Escape':
        event.preventDefault();
        setToggled(false);
        break;
    }
  };

  const handleItemClick = async (action: () => void | Promise<void>, disabled?: boolean) => {
    if (!disabled) {
      await action();
      setToggled(false);
    }
  };

  return (
    <div className="relative h-[18px]" ref={menuRef} onKeyDown={handleKeyDown}>
      <button
        onClick={() => setToggled((x) => !x)}
        aria-expanded={toggled}
        aria-haspopup="true"
        aria-label="Help menu"
        type="button"
        className="h-[18px]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
          <path d="M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
          <path d="M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
        </svg>
      </button>

      {toggled && (
        <div
          className="absolute -left-24 top-full z-10 mt-1 w-28 rounded-md border border-gray-800 bg-gray-900 py-1 shadow-lg"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="menu-button"
        >
          {items.map((item, index) => (
            <button
              className={`block w-full cursor-pointer px-3 py-2 text-left text-sm transition-colors hover:bg-gray-800 focus:bg-gray-800 focus:outline-none ${
                item.disabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''
              }`}
              key={item.name}
              onClick={() => handleItemClick(item.action, item.disabled)}
              ref={(el) => (buttonRefs.current[index] = el)}
              role="menuitem"
              tabIndex={item.disabled ? -1 : 0}
              type="button"
              disabled={item.disabled}
              aria-disabled={item.disabled}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
