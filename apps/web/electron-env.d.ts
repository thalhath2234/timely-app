export type TimelyDesktop = {
  platform: NodeJS.Platform;
  notifyChat: (payload: { id: string; title: string; body: string; revision: number }) => void;
  onOpenChat: (callback: (id: string) => void) => () => void;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
};

declare global {
  interface Window {
    timelyDesktop?: TimelyDesktop;
  }
}

export {};
