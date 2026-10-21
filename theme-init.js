// Apply the stored appearance before the page paints, without remote or inline scripts.
try {
  const mode=localStorage.getItem('chrontab-appearance') || 'system';
  const dark=mode==='dark' || mode==='system' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme=dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme=dark ? 'dark' : 'light';
} catch {}
