/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Detached is when you run the game outside of the webview (for UI only development)
  readonly MODE: "development" | "production" | "detached";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
