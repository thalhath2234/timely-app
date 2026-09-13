export type TimelyDesktop = {
  platform: NodeJS.Platform;
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
