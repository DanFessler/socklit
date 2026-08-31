/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly SOCKLIT_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
