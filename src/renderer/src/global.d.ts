import type { YtdlpApi } from '../../shared/types';

declare global {
  interface Window {
    ytdlp: YtdlpApi;
  }
}

export {};
