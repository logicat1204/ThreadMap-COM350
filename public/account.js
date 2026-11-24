const byId = (id) => document.getElementById(id);
let signingUp = false;

function authMessage(data) {
  const messages = {
    USER_ALREADY_EXISTS: 'Ya existe una cuenta con este correo. Inicia sesión.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Ya existe una cuenta con este correo. Inicia sesión.',
    INVALID_EMAIL_OR_PASSWORD: 'El correo o la contraseña no son correctos.',
    INVALID_PASSWORD: 'El correo o la contraseña no son correctos.',
    PASSWORD_TOO_SHORT: 'Usa al menos 8 caracteres para la contraseña.',
    TOO_MANY_REQUESTS: 'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
  };
  return messages[data?.code] || 'No se pudo completar el acceso. Revisa tus datos e inténtalo de nuevo.';
}

function showAccessError(message) {
  byId('auth-error').textContent = message;
  byId('auth-error').hidden = false;
}

byId('auth-switch').onclick = () => {
  signingUp = !signingUp;
  byId('auth-title').textContent = signingUp ? 'Tu próxima idea empieza aquí' : 'Bienvenido de nuevo';
  byId('auth-description').textContent = signingUp ? 'Crea tu cuenta y explora tus propias conversaciones.' : 'Inicia sesión para continuar tus conversaciones.';
  byId('auth-name-field').hidden = !signingUp;
  byId('auth-name').required = signingUp;
  byId('auth-password').autocomplete = signingUp ? 'new-password' : 'current-password';
  byId('auth-submit').textContent = signingUp ? 'Crear cuenta' : 'Iniciar sesión';
  byId('auth-switch-label').textContent = signingUp ? '¿Ya tienes una cuenta?' : '¿Primera vez aquí?';
  byId('auth-switch').textContent = signingUp ? 'Iniciar sesión' : 'Crear una cuenta';
  byId('auth-error').hidden = true;
  (signingUp ? byId('auth-name') : byId('auth-email')).focus();
};

byId('auth-form').onsubmit = async (event) => {
  event.preventDefault();
  byId('auth-error').hidden = true;
  const controls = [...byId('auth-form').elements];
  controls.forEach((control) => { control.disabled = true; });
  byId('auth-submit').textContent = signingUp ? 'Creando tu cuenta…' : 'Entrando…';
  try {
    const response = await fetch(`/api/auth/${signingUp ? 'sign-up' : 'sign-in'}/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: byId('auth-name').value.trim(), email: byId('auth-email').value.trim(), password: byId('auth-password').value,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      showAccessError(response.status === 429 ? 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.' : authMessage(data));
      return;
    }
    location.reload();
  } catch {
    showAccessError('No se pudo conectar con ThreadMap. Vuelve a intentarlo.');
  } finally {
    controls.forEach((control) => { control.disabled = false; });
    byId('auth-submit').textContent = signingUp ? 'Crear cuenta' : 'Iniciar sesión';
  }
};

export async function loadAccount() {
  try {
    const response = await fetch('/api/me');
    if (!response.ok) throw new Error('No se pudo comprobar tu sesión.');
    const { user } = await response.json();
    if (user) {
      const saved = await fetch('/api/workspace');
      if (!saved.ok) throw new Error('No se pudo cargar tu historial. Recarga para volver a intentarlo.');
      const data = await saved.json();
      byId('account-name').textContent = user.name;
      byId('account-name').title = user.email;
      byId('account-avatar').textContent = user.name.slice(0, 1).toLocaleUpperCase('es');
      byId('auth-screen').hidden = true;
      byId('workspace').hidden = false;
      return { user, ...data };
    }
  } catch (error) {
    showAccessError(error.message || 'No se pudo conectar con ThreadMap.');
  }
  byId('auth-loading').hidden = true;
  byId('auth-form').hidden = false;
  // The app initializes only after a successful login reloads the page.
  return new Promise(() => {});
}

export async function signOut() {
  const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error('No se pudo cerrar la sesión. Inténtalo de nuevo.');
  location.reload();
}
