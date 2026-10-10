export interface BrowserLocation {
  protocol: string;
  hostname: string;
  port: string;
  href: string;
}

export const publicWebSocketUrl = (
  wsUrl: string,
  token: string | undefined,
  location: BrowserLocation
): string => {
  const publicUrl = new URL(wsUrl, location.href);
  publicUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  publicUrl.hostname = location.hostname;
  // URL.host preserves the old port when its new value omits one. Assign the
  // port explicitly so Pipecat's private :7860 can never escape to a browser.
  publicUrl.port = location.port;
  return token
    ? `${publicUrl.toString().replace(/\/$/, '')}/${encodeURIComponent(token)}`
    : publicUrl.toString();
};
