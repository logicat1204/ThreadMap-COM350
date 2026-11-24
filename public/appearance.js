const preference = 'threadmap.appearance';
const root = document.documentElement;

try {
  if (localStorage.getItem(preference) === 'light') root.dataset.theme = 'light';
} catch { /* The theme can still be changed for this page. */ }

export function toggleTheme() {
  const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = theme;
  try { localStorage.setItem(preference, theme); }
  catch { /* Keep the current choice until navigation. */ }
}
