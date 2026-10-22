import { PostMessageTransport } from '@modelcontextprotocol/ext-apps';

const applyTheme = (theme) => {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.piTheme = theme;
};

export const connectFirstPartyMcpApp = (app, logName) => {
  app.onhostcontextchanged = ({ theme }) => applyTheme(theme);
  void app.connect(new PostMessageTransport(window.parent, window.parent))
    .then(() => applyTheme(app.getHostContext()?.theme))
    .catch((error) => console.error(logName, error));
};
