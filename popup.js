import './bootstrap.js';
import { api, createEditor, showMessage } from './ui.js';
document.getElementById('manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.incognito || !/^https?:\/\//.test(tab.url || '')) {
    throw new Error('Open a regular HTTP or HTTPS webpage to snooze it.');
  }
  document.getElementById('tab-title').textContent = tab.title || tab.url;
  document.getElementById('tab-domain').textContent = new URL(tab.url).hostname;
  createEditor(document.getElementById('editor'), {
    tab,
    onError: (message) => showMessage(message, true),
    onSave: async (record) => {
      const result = await api('save', { record, tabId: tab.id });
      if (result.warning) {
        showMessage(result.warning);
      } else {
        window.close();
      }
    },
  });
} catch (error) {
  document.getElementById('tab-title').textContent = 'This tab cannot be snoozed';
  showMessage(error.message, true);
}
