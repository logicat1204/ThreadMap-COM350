import { setIcon } from './view.js';
const byId = (id) => document.getElementById(id);
let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', '/restablecer');
setIcon(byId('reset-reveal'), 'eye');
byId('reset-reveal').onclick = () => {
  const visible = byId('reset-password').type === 'password';
  byId('reset-password').type = visible ? 'text' : 'password';
  setIcon(byId('reset-reveal'), visible ? 'eye-off' : 'eye');
  byId('reset-reveal').setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  byId('reset-reveal').setAttribute('aria-pressed', String(visible));
};
function showError(message) { byId('reset-error').textContent = message; byId('reset-error').hidden = false; }
if (!token) { byId('reset-form').hidden = true; showError('Abre el enlace completo que te facilitó el administrador.'); }
byId('reset-form').onsubmit = async (event) => {
  event.preventDefault(); byId('reset-error').hidden = true;
  if (byId('reset-password').value !== byId('reset-confirm').value) return showError('Las contraseñas no coinciden.');
  const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword: byId('reset-password').value }) });
    if (!response.ok) { const data = await response.json(); throw new Error(data.code === 'PASSWORD_TOO_SHORT' ? 'Usa al menos 8 caracteres.' : 'El enlace no es válido, ya se utilizó o caducó. Solicita uno nuevo.'); }
    token = ''; byId('reset-form').reset(); byId('reset-form').hidden = true; byId('reset-success').hidden = false;
  } catch (error) { showError(error instanceof TypeError ? 'No se pudo conectar con el servidor. Inténtalo otra vez.' : error.message); }
  finally { button.disabled = false; }
};
