export type LogLevel = "debug" | "log" | "info" | "warn" | "error" | "off";
const logLevels: LogLevel[] = ["debug", "log", "info", "warn", "error", "off"];

function isLogLevel(level: string): level is LogLevel {
  return logLevels.includes(level as LogLevel);
}

export const createLogger = (name: string, defaultLevel: LogLevel = "off") => {
  let currentLevelIndex = logLevels.indexOf(defaultLevel);

  const isLevelEnabled = (level: LogLevel) => {
    const levelIndex = logLevels.indexOf(level);
    return levelIndex >= currentLevelIndex;
  };

  // Create the logger object with console methods that preserve the call site
  const logger = logLevels.reduce((acc, level) => {
    if (level === "off") return acc;

    // Instead of creating a wrapper function, we create a console method
    // that's already bound with the prefix formatting
    const nameStyle = "font-weight: bold; color: #4CE1F2;";
    const consoleMethod = console[level];

    // Use Object.defineProperty to create a property that returns a bound function
    // only when the logging is enabled
    Object.defineProperty(acc, level, {
      get() {
        if (!isLevelEnabled(level)) {
          return () => {}; // No-op function when logging is disabled
        }
        // Return a bound console method with the prefix already included
        return consoleMethod.bind(console, `%c${name}:`, nameStyle);
      },
      enumerable: true,
    });

    return acc;
  }, {} as Record<LogLevel, (...args: any[]) => void>);

  const setLevel = (newLevel: LogLevel) => {
    if (isLogLevel(newLevel)) {
      currentLevelIndex = logLevels.indexOf(newLevel);
    }
  };

  const throttledLog = (level: LogLevel, delay = 1000) => {
    let lastLogTime = 0;

    return (...args: any[]) => {
      const now = Date.now();
      if (now - lastLogTime > delay && isLogLevel(level)) {
        const nameStyle = "font-weight: bold; color: #4CE1F2;";
        // @ts-expect-error
        console[level](`%c${name}:`, nameStyle, ...args);
        lastLogTime = now;
      }
    };
  };

  return {
    ...logger,
    setLevel,
    throttledLog,
    isLevelEnabled,
  };
};
