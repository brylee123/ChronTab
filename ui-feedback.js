export function showMessage(message, error = false, id = 'message') {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.toggle('error', error);
}
const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
export function formatDate(value) {
  return dateFormat.format(new Date(value));
}
