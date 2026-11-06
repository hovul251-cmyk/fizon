/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPWRITE_ENDPOINT?: string;
  readonly VITE_APPWRITE_PROJECT_ID?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_HOOKS_URL?: string;
  readonly VITE_GITHUB_REPO?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*?worker' {
  const W: new () => Worker;
  export default W;
}
