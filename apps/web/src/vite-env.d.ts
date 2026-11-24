/// <reference types="vite/client" />

interface DukaanDeskBridge {
  platform?: string;
  shell?: string;
  saveTextFile?: (
    defaultName: string,
    text: string,
  ) => Promise<{ saved: boolean; filePath?: string }>;
  printReceipt?: (payload: {
    html: string;
    deviceName?: string;
    silent?: boolean;
  }) => Promise<{ ok?: boolean; reason?: string | null }>;
  pickFolder?: (current?: string | null) => Promise<{ ok: boolean; path?: string }>;
}

interface Window {
  dukaandesk?: DukaanDeskBridge;
}
