import { PostMessageTransport } from '@modelcontextprotocol/ext-apps';

const applyTheme = (theme, onThemeChange) => {
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.dataset.piTheme = theme;
  onThemeChange?.(theme);
};

export const connectFirstPartyMcpApp = (app, logName, { onThemeChange } = {}) => {
  app.onhostcontextchanged = ({ theme }) => applyTheme(theme, onThemeChange);
  void app.connect(new PostMessageTransport(window.parent, window.parent))
    .then(() => applyTheme(app.getHostContext()?.theme, onThemeChange))
    .catch((error) => console.error(logName, error));
};
