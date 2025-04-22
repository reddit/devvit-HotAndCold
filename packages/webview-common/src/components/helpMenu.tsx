import { useState, useRef, useEffect } from 'react';

const HamburgerIcon = () => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="11" fill="currentColor">
      <path d="M13.667 6.333H.333v-1h13.334v1Zm0-5.666H.333v1h13.334v-1Zm0 9.333H.333v1h13.334v-1Z" />
    </svg>
  );
};
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
      case 'ArrowDown': {
        event.preventDefault();
        const nextDownIndex = findNextEnabledIndex(focusIndex, 'next');
        buttonRefs.current[nextDownIndex]?.focus();
        setFocusIndex(nextDownIndex);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const nextUpIndex = findNextEnabledIndex(focusIndex, 'prev');
        buttonRefs.current[nextUpIndex]?.focus();
        setFocusIndex(nextUpIndex);
        break;
      }
      case 'Tab': {
        event.preventDefault();
        const nextTabIndex = findNextEnabledIndex(focusIndex, 'next');
        buttonRefs.current[nextTabIndex]?.focus();
        setFocusIndex(nextTabIndex);
        break;
      }
      case 'Enter': {
        event.preventDefault();
        const currentButton = buttonRefs.current[focusIndex];
        if (currentButton && !items[focusIndex].disabled) {
          void handleItemClick(items[focusIndex].action, items[focusIndex].disabled);
        }
        break;
      }
      case 'Escape': {
        event.preventDefault();
        setToggled(false);
        break;
      }
    }
  };

  const handleItemClick = async (action: () => void | Promise<void>, disabled?: boolean) => {
    if (!disabled) {
      await action();
      setToggled(false);
    }
  };

  return (
    <div className="relative text-gray-900 dark:text-white" ref={menuRef} onKeyDown={handleKeyDown}>
      <button
        onClick={() => setToggled((x) => !x)}
        aria-expanded={toggled}
        aria-haspopup="true"
        aria-label="Menu"
        type="button"
        className="flex items-center gap-2 rounded-full bg-gray-50 px-4 py-3 text-current sm:px-3 sm:py-2 dark:bg-black"
      >
        <HamburgerIcon />
        <span className="hidden sm:inline">Menu</span>
      </button>

      {toggled && (
        <div
          className="absolute right-0 top-full z-[10000] mt-1 w-36 rounded-md border border-gray-800 bg-gray-900 py-1 shadow-lg"
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
              onClick={() => void handleItemClick(item.action, item.disabled)}
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
