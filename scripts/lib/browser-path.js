import { existsSync } from 'node:fs';

export function findBrowserExecutable({ preferEdge = false } = {}) {
  if (process.env.CHRONTAB_BROWSER) {
    return process.env.CHRONTAB_BROWSER;
  }
  const paths =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  if (preferEdge && process.platform === 'win32') {
    paths.reverse();
  }
  return paths.find((path) => existsSync(path));
}
