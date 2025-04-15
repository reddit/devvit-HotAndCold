/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */ // The logger can log any type
export type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error' | 'off';
const logLevels: LogLevel[] = ['debug', 'log', 'info', 'warn', 'error', 'off'];

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  name: string;
  message: string[];
}

function isLogLevel(level: string): level is LogLevel {
  return logLevels.includes(level as LogLevel);
}

function createOverlayElements() {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
  overlay.style.zIndex = '9999';
  overlay.style.overflowY = 'auto';
  overlay.style.padding = '10px';
  overlay.style.display = 'none'; // Hidden by default

  // Create log container
  const logContainer = document.createElement('pre');
  logContainer.style.color = 'white';
  logContainer.style.fontFamily = 'monospace';
  logContainer.style.fontSize = '12px';
  logContainer.style.margin = '0';
  logContainer.style.whiteSpace = 'pre-wrap';
  overlay.appendChild(logContainer);

  // Create toggle button
  const toggleButton = document.createElement('button');
  toggleButton.textContent = '📋';
  toggleButton.style.position = 'fixed';
  toggleButton.style.bottom = '20px';
  toggleButton.style.right = '20px';
  toggleButton.style.zIndex = '10000';
  toggleButton.style.padding = '8px 12px';
  toggleButton.style.backgroundColor = '#4CE1F2';
  toggleButton.style.border = 'none';
  toggleButton.style.borderRadius = '50%';
  toggleButton.style.cursor = 'pointer';
  toggleButton.style.width = '40px';
  toggleButton.style.height = '40px';
  toggleButton.style.fontSize = '20px';
  toggleButton.style.display = 'flex';
  toggleButton.style.alignItems = 'center';
  toggleButton.style.justifyContent = 'center';
  toggleButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';

  const clearButton = document.createElement('button');
  clearButton.textContent = '💩';
  clearButton.style.position = 'fixed';
  clearButton.style.top = '20px';
  clearButton.style.right = '20px';
  clearButton.style.zIndex = '10000';
  clearButton.style.padding = '8px 12px';
  clearButton.style.backgroundColor = '#4CE1F2';
  clearButton.style.border = 'none';
  clearButton.style.borderRadius = '50%';
  clearButton.style.cursor = 'pointer';
  clearButton.style.width = '40px';
  clearButton.style.height = '40px';
  clearButton.style.fontSize = '20px';
  clearButton.style.display = 'flex';
  clearButton.style.alignItems = 'center';
  clearButton.style.justifyContent = 'center';
  clearButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';

  let isVisible = false;
  toggleButton.addEventListener('click', () => {
    isVisible = !isVisible;
    overlay.style.display = isVisible ? 'block' : 'none';
    clearButton.style.display = isVisible ? 'block' : 'none';
    toggleButton.style.backgroundColor = isVisible ? '#FF6B6B' : '#4CE1F2';
    toggleButton.textContent = isVisible ? '✕' : '📋';
  });

  clearButton.addEventListener('click', () => {
    logContainer.innerHTML = '';
  });

  return { overlay, logContainer, toggleButton, clearButton };
}

function formatLogEntry(entry: LogEntry): string {
  return `<span>[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.name}: ${entry.message.join(
    ' '
  )}</span>\n`;
}

export const createLogger = (
  name: string,
  defaultLevel: LogLevel = 'off',
  uiStream: boolean = false
) => {
  let currentLevelIndex = logLevels.indexOf(defaultLevel);
  let overlayElements: {
    overlay: HTMLDivElement;
    logContainer: HTMLPreElement;
    toggleButton: HTMLButtonElement;
    clearButton: HTMLButtonElement;
  } | null = null;

  if (uiStream) {
    overlayElements = createOverlayElements();
    document.body.appendChild(overlayElements.overlay);
    document.body.appendChild(overlayElements.toggleButton);
    document.body.appendChild(overlayElements.clearButton);
  }

  const isLevelEnabled = (level: LogLevel) => {
    const levelIndex = logLevels.indexOf(level);
    return levelIndex >= currentLevelIndex;
  };

  const appendToOverlay = (level: LogLevel, ...args: any[]) => {
    if (!overlayElements) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString().split('T')[1].split('.')[0],
      level,
      name,
      message: args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))),
    };

    const formattedLog = formatLogEntry(entry);
    console.log(overlayElements, formattedLog);
    overlayElements.logContainer.insertAdjacentHTML('beforeend', formattedLog);

    // Auto-scroll to bottom
    overlayElements.logContainer.scrollTop = overlayElements.logContainer.scrollHeight;
  };

  // Create the logger object with console methods that preserve the call site
  const logger = logLevels.reduce(
    (acc, level) => {
      if (level === 'off') return acc;

      // UI Stream logging
      if (uiStream) {
        acc[level] = (...args) => {
          acc[level] = console[level].bind(console, `${name}:`);
          appendToOverlay(level, ...args);
        };
      } else {
        acc[level] = console[level].bind(console, `${name}:`);
      }

      return acc;
    },
    {} as Record<LogLevel, (...args: any[]) => void>
  );

  const setLevel = (newLevel: LogLevel) => {
    if (isLogLevel(newLevel)) {
      currentLevelIndex = logLevels.indexOf(newLevel);
    }
  };

  const throttledLog = (level: LogLevel, delay = 1000) => {
    let lastLogTime = 0;

    return (...args: any[]) => {
      const now = Date.now();
      if (now - lastLogTime > delay && isLogLevel(level) && level !== 'off') {
        // Use direct console method binding to preserve call site
        console[level].bind(console, `${name}:`)(...args);

        // UI Stream logging
        if (uiStream) {
          appendToOverlay(level, ...args);
        }

        lastLogTime = now;
      }
    };
  };

  const destroy = () => {
    if (overlayElements) {
      if (overlayElements.overlay.parentNode) {
        overlayElements.overlay.parentNode.removeChild(overlayElements.overlay);
      }
      if (overlayElements.toggleButton.parentNode) {
        overlayElements.toggleButton.parentNode.removeChild(overlayElements.toggleButton);
      }
    }
  };

  return {
    ...logger,
    setLevel,
    throttledLog,
    isLevelEnabled,
    destroy,
  };
};
