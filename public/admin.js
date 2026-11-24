import { el, setIcon } from './view.js';

const byId = (id) => document.getElementById(id);
let token = '';
let expiresTimer;
let setupRequired = false;
let users = [];
const date = (value) => value ? new Date(value).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin accesos medidos';

function clearError() { byId('admin-error').hidden = true; }
function showError(error) { byId('admin-error').textContent = error.message; byId('admin-error').hidden = false; }
function clearPasswords() {
  document.querySelectorAll('.password-entry input, #confirm-admin-password').forEach((input) => { input.value = ''; input.type = 'password'; });
  document.querySelectorAll('[data-reveal]').forEach((button) => { setIcon(button, 'eye'); button.setAttribute('aria-label', 'Mostrar contraseña'); button.setAttribute('aria-pressed', 'false'); });
}
function lockView(message = '') {
  token = '';
  users = [];
  clearTimeout(expiresTimer);
  byId('admin-dashboard').hidden = true;
  byId('admin-lock').hidden = true;
  byId('admin-users').replaceChildren();
  byId('admin-audit').replaceChildren();
  byId('admin-stats').replaceChildren();
  byId('reset-link-value').value = '';
  if (byId('reset-link-dialog').open) byId('reset-link-dialog').close();
  clearPasswords();
  byId('admin-gate').hidden = false;
  byId('admin-notice').textContent = message;
}
async function request(path, body) {
  const response = await fetch('/api/admin/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (token && [401, 403, 423].includes(response.status)) lockView('Vuelve a desbloquear el panel para continuar.');
    throw new Error(data.error || 'No se pudo completar la operación.');
  }
  return data;
}
function notice(message) { byId('admin-notice').textContent = message; }
function renderUsers() {
  const query = byId('user-search').value.trim().toLocaleLowerCase('es');
  const rows = [];
  for (const user of users.filter((entry) => `${entry.name} ${entry.email}`.toLocaleLowerCase('es').includes(query))) {
    const row = el('tr');
    const identity = el('td');
    identity.append(el('strong', '', user.name), el('span', 'admin-email', user.email), el('small', '', `Registro: ${date(user.createdAt)}`));
    const logins = el('td');
    logins.append(el('strong', '', String(user.loginCount)), el('small', '', date(user.lastLoginAt)));
    const usage = el('td');
    usage.append(el('strong', '', `${user.remaining} disponibles`), el('small', '', `${user.used} usados de ${user.allowance}`));
    const grant = el('td');
    const form = el('form', 'admin-grant-form');
    const amount = el('input');
    amount.type = 'number'; amount.min = '1'; amount.max = '1000'; amount.step = '1'; amount.value = '5'; amount.required = true;
    amount.setAttribute('aria-label', `Mensajes adicionales para ${user.email}`);
    const add = el('button', 'secondary-button', 'Añadir'); add.type = 'submit';
    form.append(amount, add);
    form.onsubmit = async (event) => {
      event.preventDefault(); clearError(); add.disabled = true;
      try { await request('grant', { userId: user.id, amount: Number(amount.value) }); await loadUsers(); notice(`Se añadieron ${amount.value} mensajes a ${user.email}.`); }
      catch (error) { showError(error); }
      finally { add.disabled = false; }
    };
    grant.append(form);
    const recovery = el('td');
    const reset = el('button', 'secondary-button', 'Crear enlace'); reset.type = 'button';
    reset.setAttribute('aria-label', `Crear enlace de recuperación para ${user.email}`);
    reset.onclick = async () => {
      clearError(); reset.disabled = true;
      const activeToken = token;
      try {
        const data = await request('reset-link', { userId: user.id });
        if (!activeToken || activeToken !== token) return;
        byId('reset-link-recipient').textContent = `Para ${user.email}. Un enlace nuevo invalida los anteriores.`;
        byId('reset-link-value').value = data.url;
        byId('reset-link-status').textContent = '';
        byId('reset-link-dialog').showModal();
      } catch (error) { showError(error); }
      finally { reset.disabled = false; }
    };
    recovery.append(reset);
    row.append(identity, logins, usage, grant, recovery);
    rows.push(row);
  }
  if (!rows.length) { const row = el('tr'); const cell = el('td', '', 'No hay cuentas que coincidan.'); cell.colSpan = 5; row.append(cell); rows.push(row); }
  byId('admin-users').replaceChildren(...rows);
}
async function loadUsers() {
  const activeToken = token;
  const data = await request('users');
  if (!activeToken || activeToken !== token) return;
  users = data.users;
  const stats = [['Personas registradas', data.summary.registered], ['Personas con accesos', data.summary.peopleWithLogins], ['Accesos registrados', data.summary.logins]];
  byId('admin-stats').replaceChildren(...stats.map(([label, count]) => { const card = el('div', 'admin-stat'); card.append(el('strong', '', String(count)), el('span', '', label)); return card; }));
  byId('metrics-note').textContent = `Métricas desde ${date(data.metricsStartedAt)}. El registro cuenta como primer acceso. Para cuentas anteriores se incluyen las sesiones conservadas; no se reconstruyen accesos ya eliminados.`;
  const labels = { setup: 'Administración activada', unlock: 'Panel desbloqueado', grant: 'Mensajes añadidos', 'reset-link': 'Enlace de recuperación generado', 'change-password': 'Contraseña administrativa cambiada' };
  byId('admin-audit').replaceChildren(...data.audit.map((item) => {
    const user = users.find((entry) => entry.id === item.targetId);
    return el('li', '', `${date(item.createdAt)} · ${labels[item.action] || item.action}${user ? ` · ${user.email}` : ''}${item.amount ? ` · +${item.amount}` : ''}`);
  }));
  renderUsers();
}
byId('admin-gate-form').onsubmit = async (event) => {
  event.preventDefault(); clearError(); notice('');
  const password = byId('gate-password').value;
  if (setupRequired && password !== byId('gate-confirm').value) return showError(new Error('Las contraseñas administrativas no coinciden.'));
  byId('gate-submit').disabled = true;
  try {
    const data = await request(setupRequired ? 'setup' : 'unlock', { password, loginPassword: byId('login-password').value, code: byId('setup-code').value });
    token = data.token;
    setupRequired = false;
    setGateMode();
    byId('setup-code').value = '';
    clearPasswords();
    expiresTimer = setTimeout(() => lockView('El panel se bloqueó tras 15 minutos.'), Math.max(0, data.expiresAt - Date.now()));
    await loadUsers();
    if (token !== data.token) return;
    byId('admin-gate').hidden = true;
    byId('admin-dashboard').hidden = false;
    byId('admin-lock').hidden = false;
  } catch (error) { clearPasswords(); showError(error); }
  finally { byId('gate-submit').disabled = false; }
};
function setGateMode() {
  byId('admin-setup-fields').hidden = !setupRequired;
  byId('gate-confirm-field').hidden = !setupRequired;
  byId('setup-code').required = setupRequired;
  byId('login-password').required = setupRequired;
  byId('gate-confirm').required = setupRequired;
  byId('gate-password').minLength = setupRequired ? 12 : 1;
  byId('gate-password').autocomplete = setupRequired ? 'new-password' : 'current-password';
  byId('gate-title').textContent = setupRequired ? 'Activa tu espacio privado' : 'Desbloquear administración';
  byId('gate-description').textContent = setupRequired ? 'Confirma el código del servidor y crea una segunda contraseña de al menos 12 caracteres, distinta de la de tu cuenta.' : 'Introduce tu contraseña administrativa. Es distinta de la de tu cuenta.';
  byId('gate-submit').textContent = setupRequired ? 'Activar administración' : 'Desbloquear';
}
byId('admin-lock').onclick = async () => {
  try { await request('lock', {}); } catch { /* Clearing the client is still required on network failure. */ }
  lockView('Panel bloqueado.'); clearError();
};
byId('admin-password-form').onsubmit = async (event) => {
  event.preventDefault(); clearError();
  const password = byId('new-admin-password').value;
  if (password !== byId('confirm-admin-password').value) return showError(new Error('Las nuevas contraseñas no coinciden.'));
  const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  try { await request('password', { currentPassword: byId('current-admin-password').value, password }); lockView('Contraseña actualizada. Desbloquea el panel con la nueva contraseña.'); }
  catch (error) { showError(error); }
  finally { button.disabled = false; clearPasswords(); }
};
byId('admin-refresh').onclick = () => { clearError(); loadUsers().catch(showError); };
byId('user-search').oninput = renderUsers;
byId('reset-link-close').onclick = () => byId('reset-link-dialog').close();
byId('reset-link-dialog').addEventListener('close', () => { byId('reset-link-value').value = ''; });
byId('reset-link-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(byId('reset-link-value').value); byId('reset-link-status').textContent = 'Enlace copiado.'; }
  catch { byId('reset-link-status').textContent = 'Selecciona el enlace y cópialo manualmente.'; }
};
document.querySelectorAll('[data-reveal]').forEach((button) => {
  setIcon(button, 'eye');
  button.onclick = () => {
    const input = byId(button.dataset.reveal);
    const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
    setIcon(button, visible ? 'eye-off' : 'eye'); button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña'); button.setAttribute('aria-pressed', String(visible));
  };
});
window.addEventListener('pagehide', () => {
  if (token) fetch('/api/admin/lock', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' }).catch(() => {});
  lockView();
});
window.addEventListener('pageshow', (event) => { if (event.persisted) lockView('Vuelve a desbloquear el panel.'); });
try { const status = await request('status'); setupRequired = status.setupRequired; setGateMode(); byId('admin-gate').hidden = false; }
catch (error) { showError(error); }
