import { createScheduler, WAKE_ALARM } from './scheduler.js';

const scheduler = createScheduler(chrome);
const tick = () => void scheduler.tick().catch(console.error);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) {
    return false;
  }
  scheduler.handleMessage(message).then(
    (data) => respond({ ok: true, data }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WAKE_ALARM) {
    tick();
  }
});
chrome.runtime.onStartup.addListener(tick);
chrome.runtime.onInstalled.addListener(tick);

// Chromium browsers differ in alarm persistence; reconcile whenever the worker starts.
tick();
