export async function api(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) {
    throw new Error(response?.error || 'The extension did not respond. Try reloading it.');
  }
  return response.data;
}
