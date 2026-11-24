# ThreadMap

Aplicación web en español para conversar con IA y explorar preguntas relacionadas en un árbol de ramas. Requiere Node.js 22.9 o superior (recomendado: Node.js 24 LTS), Better Auth y SQLite.

## Ejecutar

```powershell
npm ci
npm start
```

Abre la [portada de ThreadMap](http://127.0.0.1:3000) para ver la demo o entra directamente a [la aplicación](http://127.0.0.1:3000/app). Crea una cuenta y conecta OpenAI o Gemini para generar respuestas. Durante el desarrollo, `npm run dev` reinicia el servidor al editar sus módulos.

## Cuentas e historial

El registro utiliza nombre, correo y contraseña de al menos ocho caracteres. El botón del ojo permite mostrar u ocultar la contraseña tanto al entrar como al registrarse. Esta versión de demo no envía correos de confirmación; la recuperación se hace con enlaces privados generados por el administrador. Better Auth gestiona los hashes de contraseña y las sesiones con cookies HttpOnly y SameSite. Las sesiones duran hasta siete días; cerrar sesión las invalida en el servidor.

El primer inicio crea automáticamente `data/threadmap.sqlite` y `data/session-secret`. Las cuentas, sesiones y árboles de conversación se guardan en SQLite; el historial queda separado por usuario. Ambos archivos son privados y están excluidos de Git. Para conservarlos, respalda el directorio `data` con el servidor detenido. No elimines el secreto de sesión si quieres mantener las sesiones entre reinicios.

Puedes ajustar `DATABASE_PATH`, `APP_URL` y `BETTER_AUTH_SECRET` en `.env`. En local, `APP_URL` se calcula a partir de `PORT` si no se configura. Si especificas un secreto propio, debe tener al menos 32 caracteres. Node escucha en `127.0.0.1`; si configuras un `APP_URL` público, acepta ese host además de los locales para servirlo detrás del proxy HTTPS. En producción, `APP_URL` HTTPS y un `BETTER_AUTH_SECRET` permanente son obligatorios.

## Despliegue en EC2

Sigue [la guía de Ubuntu 26.04](deploy/README.md) para publicar la instancia `threadmap`, con SSH para administración y Caddy para HTTPS. Puedes actualizar manualmente por SSH; GitHub Actions con OIDC/SSM es opcional. El instalador y el script de versiones conservan cuentas e historial fuera del código. El workflow no despliega hasta configurar `DEPLOY_ENABLED=true`.

`TRUST_PROXY=loopback` permite usar la IP que el Caddy local sobrescribe en `X-ThreadMap-Client-IP`; cabeceras de otros pares no se consideran confiables. `AUTH_SIGNIN_RATE_LIMIT` y `AUTH_SIGNUP_RATE_LIMIT` configuran intentos por minuto e IP (8 y 5 por defecto, 30 y 20 en la plantilla de producción). `GET /health` permite comprobar que el proceso está disponible.

Cada vez que abres la aplicación empiezas en un chat vacío. Los chats vacíos y los borradores no aparecen en **Conversaciones** ni se guardan en SQLite: se incorporan al enviar el primer mensaje. Si tu navegador conserva conversaciones de la versión anterior, aparece **Importar historial local**: solo se copian a la cuenta con la que confirmes la importación y el original permanece en el navegador.

El guardado es automático. Si falla, puedes reintentarlo o descargar tus cambios en JSON. Si otra pestaña modificó el historial, se evita sobrescribirla y se ofrece descargar los cambios antes de recargar. Las claves personales de IA siguen solo en memoria y no se guardan en SQLite.

En **Conversaciones**, pasa el cursor sobre un chat para mostrar la papelera; también aparece al enfocar la fila con el teclado y siempre está visible en móvil. Elimina la conversación completa y sus ramas, con **Deshacer** disponible durante ocho segundos. El cupo gratuito no se reinicia al eliminar chats. Si visitas `/` con una sesión válida, el servidor te redirige a `/app`; sin sesión muestra la landing. Las URLs antiguas `/app?modo=login` y `/app?modo=registro` también se limpian cuando ya estás autenticado.

## Conectar OpenAI o Gemini

En **Configuración**, elige el **Proveedor** y el **Modo de conexión**. La selección inicial es **Gemini → Clave de la plataforma**; se respeta una elección anterior del navegador.

Cada cuenta empieza con **5 mensajes gratuitos en total**, compartidos entre proveedores, conversaciones, ramas y chats temporales. El administrador puede añadir mensajes a una cuenta desde su panel. El cupo se guarda en SQLite y no se reinicia al cerrar sesión, borrar conversaciones o reiniciar el servidor. Se reserva de forma atómica antes de llamar al proveedor y se devuelve si la solicitud falla. Al agotarlo, la interfaz solicita una API key personal o más mensajes al administrador; el servidor también bloquea cualquier intento de seguir usando la clave de plataforma. Las claves personales no consumen ese cupo. Al actualizar una base existente se preserva el uso; las ampliaciones del cupo se suman al límite actual.

- **Clave de la plataforma.** Crea `.env` a partir de `.env.example` si aún no existe. Configura `OPENAI_API_KEY` para OpenAI, `GEMINI_API_KEY` para Gemini, o ambas. Reinicia el servidor y elige **Clave de la plataforma**. Las claves se usan en el servidor y la interfaz solo recibe su estado de disponibilidad.
- **Clave personal.** Selecciona **Mi propia clave**, pega una clave del proveedor seleccionado y guarda. Para Gemini, puedes crearla en [Google AI Studio](https://aistudio.google.com/apikey). La clave queda en memoria hasta que recargues, cierres la página o guardes otra conexión.

Cada proveedor usa su modelo configurado tanto con la clave de plataforma como con una personal.

| Proveedor | Variable de modelo | Modelo predeterminado |
| --- | --- | --- |
| OpenAI | `OPENAI_MODEL` | `gpt-5-mini` |
| Gemini | `GEMINI_MODEL` | `gemini-3.5-flash-lite` |

`PORT` permite cambiar el puerto local. ThreadMap envía el contexto de la rama al proveedor seleccionado mediante [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) o [Gemini generateContent](https://aistudio.google.com/api-reference/generate-content/generate-content).

## Explorar ramas

1. Selecciona texto dentro de una respuesta y pulsa **Ask about this**. También puedes usar el icono de rama de una respuesta del asistente para partir de ella completa. Los mensajes del usuario no ofrecen la acción de crear ramas.
2. Escribe tu pregunta y envíala. El mapa añade un nodo, y el chat conserva la referencia y el contexto heredado.
3. En **Configuración → Mapa de conversación** puedes elegir si el mapa se abre al crear una rama. Si lo desactivas, se mantiene cerrado y se anima su icono; un mapa que ya está abierto permanece abierto. La preferencia se guarda por cuenta en ese navegador, sin necesidad de configurar una clave de IA. Un único botón con forma de rama se desplaza entre el chat y el encabezado del mapa al mostrarlo u ocultarlo; al pasar el cursor indica la acción de abrir o cerrar. También puedes usar **Ctrl+Y**. El botón de ampliar abre una ventana grande con bordes redondeados y fondo desenfocado. **Escape**, el fondo exterior o el botón de restaurar permiten volver al panel.
4. Pasa el cursor sobre un nodo para ver el fragmento marcado, la rama de origen y la respuesta. Desplázate dentro de la vista previa si el contenido es largo. Con el teclado, enfoca el nodo y pulsa **↓** para entrar a la vista previa.
5. Selecciona cualquier nodo para ver su conversación. Usa los botones junto a los nodos para mostrar u ocultar sus descendientes. Puedes arrastrar el lienzo, hacer zoom, ajustarlo a la vista y redimensionar el panel en escritorio.

El historial se guarda en el servidor por cuenta. El tema se guarda en el navegador. Cada rama contiene únicamente sus propios mensajes y un enlace al mensaje de origen. Para construir el contexto, ThreadMap recorre sus ancestros hasta cada punto de bifurcación.

**Ctrl+B** abre o cierra el panel izquierdo. **Buscar conversaciones** abre una ventana con fondo desenfocado: busca en títulos y mensajes, sin distinguir mayúsculas ni tildes, y agrupa las coincidencias por conversación y rama. Usa **↑/↓** y **Enter**, o selecciona un resultado, para ir directamente al mensaje. Los chats temporales y vacíos quedan fuera de la búsqueda.

Ambos proveedores reciben la instrucción: `responde de forma directa, breve y muy tecnica.`

En móviles, el chat ocupa todo el ancho: el menú se abre desde el botón del encabezado y el cuadro de escritura permanece abajo, también en un chat vacío. En pantallas estrechas, el botón de ramas abre directamente el mapa como ventana grande con bordes redondeados y fondo desenfocado. Escape, el fondo exterior o el propio botón lo cierran. En escritorio, los controles del menú y del mapa muestran sus atajos **Ctrl+B** y **Ctrl+Y** al pasar el cursor o enfocarlos con el teclado.

Las respuestas renderizan fórmulas con KaTeX: `$…$` y `\(…\)` en línea, `$$…$$` y `\[…\]` en bloques. Los bloques de código incluyen resaltado de sintaxis y un botón para copiar todo su contenido. Las dependencias y fuentes se sirven desde `public/vendor`, sin CDN. Para actualizarlas ejecuta `npm run vendor` después de actualizar los paquetes y guarda esos archivos junto con el lockfile.

## Chat temporal

En una conversación nueva, activa **Chat temporal** antes de enviar el primer mensaje. La conversación y sus ramas se mantienen en memoria mientras estés en ese chat y se descartan al navegar a otro o recargar. Al solicitar una respuesta, el proveedor de IA seleccionado recibe el contexto de la rama.

## Administración privada

El panel `/admin` está limitado a **josiasquispe999@gmail.com**, verificado en el servidor en cada operación. Inicia sesión con esa cuenta y abre **Administración** en el menú lateral. No se crea ninguna cuenta ni contraseña administrativa predeterminada.

La primera activación requiere un código de un solo uso, la contraseña actual de esa cuenta y una segunda contraseña administrativa de 12 a 128 caracteres, distinta de la principal. El código se genera al iniciar el servidor: `data/admin-setup-code` en local, o `/var/lib/threadmap/admin-setup-code` en el despliegue estándar. En EC2 puedes leerlo por SSH con `sudo cat /var/lib/threadmap/admin-setup-code`. Esta comprobación evita que el registro abierto y sin verificación de correo permita apropiarse del panel. Tras activarlo, la propiedad queda vinculada al ID de la cuenta; el código se elimina.

La segunda contraseña se pide cada vez que entras al panel. El permiso temporal solo se guarda en memoria del navegador, está vinculado a tu sesión normal y caduca a los 15 minutos. **Bloquear**, salir de la página, cerrar la sesión principal o cambiar la contraseña administrativa invalida el acceso correspondiente. Los intentos de desbloqueo se limitan en SQLite a cinco cada 15 minutos. Para cambiar la contraseña desde dentro se requiere la actual y se invalidan todos los permisos administrativos.

El panel muestra nombres, correos, registros, accesos, último acceso, mensajes usados y cupos. Se contabilizan los accesos desde esta actualización (el registro con sesión cuenta como el primero); para cuentas anteriores solo se recuperan las sesiones que todavía existen. No se presentan cifras históricas inexistentes como si fueran completas.

Las contraseñas de cuentas y del panel son hashes: no se muestran ni se pueden recuperar en texto. Para ayudar a una persona, genera **Crear enlace**, cópialo y compártelo por un medio privado. Dura 15 minutos, solo se usa una vez y otro enlace para la misma persona invalida el anterior. La persona elige su nueva contraseña en `/restablecer`; el cambio revoca sus sesiones anteriores y conserva conversaciones y cupo. No se envían correos automáticamente. Los enlaces usan un fragmento y se retiran de la barra de direcciones al abrirlos, para evitar poner el token en consultas o registros HTTP.

**Añadir mensajes** incrementa el cupo de esa persona, sin borrar su consumo. Los cambios y enlaces generados quedan registrados en la actividad administrativa. La base, el código de activación y los secretos están excluidos de Git. Las copias de la base contienen datos privados y deben mantenerse bajo el mismo control de acceso.

## Pruebas

```powershell
npm test
```

Las pruebas cubren el contexto de ramas anidadas y hermanas, el colapso de nodos y la selección de credenciales y modelos para ambos proveedores. También prueban el registro real con cookies, aislamiento entre cuentas, hashes de contraseña, cierre de sesión, persistencia al reabrir SQLite, conflictos entre pestañas, validación de árboles, exclusión de chats temporales y limitación de intentos de acceso. El cupo se verifica con solicitudes simultáneas, errores, dos cuentas, ambos proveedores y claves personales. Las pruebas de renderizado cubren notación cuántica, bloques matemáticos, resaltado, copia completa y contenido no confiable. Los proveedores de IA se simulan para ejecutar las pruebas sin claves ni cargos. Las pruebas de cuentas necesitan permiso para abrir conexiones HTTP locales y crean bases temporales independientes.
