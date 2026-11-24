# ThreadMap

Aplicación web en español para conversar con IA y explorar preguntas relacionadas en un árbol de ramas. Requiere Node.js 22.9 o superior (recomendado: Node.js 24 LTS), Better Auth y SQLite.

## Ejecutar

```powershell
npm ci
npm start
```

Abre [ThreadMap](http://127.0.0.1:3000), crea una cuenta y empieza una conversación. Para generar respuestas nuevas, conecta OpenAI o Gemini. Durante el desarrollo, `npm run dev` reinicia el servidor al editar sus módulos.

## Cuentas e historial

El registro utiliza nombre, correo y contraseña de al menos ocho caracteres. Esta versión de demo no envía correos de confirmación ni ofrece recuperación de contraseña por email. Better Auth gestiona los hashes de contraseña y las sesiones con cookies HttpOnly y SameSite. Las sesiones duran hasta siete días; cerrar sesión las invalida en el servidor.

El primer inicio crea automáticamente `data/threadmap.sqlite` y `data/session-secret`. Las cuentas, sesiones y árboles de conversación se guardan en SQLite; el historial queda separado por usuario. Ambos archivos son privados y están excluidos de Git. Para conservarlos, respalda el directorio `data` con el servidor detenido. No elimines el secreto de sesión si quieres mantener las sesiones entre reinicios.

Puedes ajustar `DATABASE_PATH`, `APP_URL` y `BETTER_AUTH_SECRET` en `.env`. En local, `APP_URL` se calcula a partir de `PORT` si no se configura. Si especificas un secreto propio, debe tener al menos 32 caracteres. El servidor continúa restringido a conexiones locales; el despliegue público y su proxy HTTPS se configurarán por separado.

Las cuentas nuevas empiezan con un chat vacío. Si tu navegador conserva conversaciones de la versión anterior, aparece **Importar historial local**: solo se copian a la cuenta con la que confirmes la importación y el original permanece en el navegador.

El guardado es automático. Si falla, puedes reintentarlo o descargar tus cambios en JSON. Si otra pestaña modificó el historial, se evita sobrescribirla y se ofrece descargar los cambios antes de recargar. Las claves personales de IA siguen solo en memoria y no se guardan en SQLite.

## Conectar OpenAI o Gemini

En **Configuración**, elige el **Proveedor** y el **Modo de conexión**.

- **Clave de la plataforma.** Crea `.env` a partir de `.env.example` si aún no existe. Configura `OPENAI_API_KEY` para OpenAI, `GEMINI_API_KEY` para Gemini, o ambas. Reinicia el servidor y elige **Clave de la plataforma**. Las claves se usan en el servidor y la interfaz solo recibe su estado de disponibilidad.
- **Clave personal.** Selecciona **Mi propia clave**, pega una clave del proveedor seleccionado y guarda. Para Gemini, puedes crearla en [Google AI Studio](https://aistudio.google.com/apikey). La clave queda en memoria hasta que recargues, cierres la página o guardes otra conexión.

Cada proveedor usa su modelo configurado tanto con la clave de plataforma como con una personal.

| Proveedor | Variable de modelo | Modelo predeterminado |
| --- | --- | --- |
| OpenAI | `OPENAI_MODEL` | `gpt-5-mini` |
| Gemini | `GEMINI_MODEL` | `gemini-3.1-flash-lite` |

`PORT` permite cambiar el puerto local. ThreadMap envía el contexto de la rama al proveedor seleccionado mediante [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) o [Gemini generateContent](https://aistudio.google.com/api-reference/generate-content/generate-content).

## Explorar ramas

1. Selecciona texto dentro de una respuesta y pulsa **Ask about this**. También puedes usar el icono de rama de un mensaje para partir de la pregunta o respuesta completa.
2. Escribe tu pregunta y envíala. El mapa añade un nodo, y el chat conserva la referencia y el contexto heredado.
3. El mapa se abre al crear una rama. Un único botón con forma de rama se desplaza entre el chat y el encabezado del mapa al mostrarlo u ocultarlo; también puedes usar **Ctrl+Y**. El botón de ampliar abre una ventana grande con bordes redondeados y fondo desenfocado. **Escape**, el fondo exterior o el botón de restaurar permiten volver al panel.
4. Pasa el cursor sobre un nodo para ver el fragmento marcado, la rama de origen y la respuesta. Desplázate dentro de la vista previa si el contenido es largo. Con el teclado, enfoca el nodo y pulsa **↓** para entrar a la vista previa.
5. Selecciona cualquier nodo para ver su conversación. Usa los botones junto a los nodos para mostrar u ocultar sus descendientes. Puedes arrastrar el lienzo, hacer zoom, ajustarlo a la vista y redimensionar el panel en escritorio.

El historial se guarda en el servidor por cuenta. El tema se guarda en el navegador. Cada rama contiene únicamente sus propios mensajes y un enlace al mensaje de origen. Para construir el contexto, ThreadMap recorre sus ancestros hasta cada punto de bifurcación.

## Chat temporal

En una conversación nueva, activa **Chat temporal** antes de enviar el primer mensaje. La conversación y sus ramas se mantienen en memoria mientras estés en ese chat y se descartan al navegar a otro o recargar. Al solicitar una respuesta, el proveedor de IA seleccionado recibe el contexto de la rama.

## Pruebas

```powershell
npm test
```

Las pruebas cubren el contexto de ramas anidadas y hermanas, el colapso de nodos y la selección de credenciales y modelos para ambos proveedores. También prueban el registro real con cookies, aislamiento entre cuentas, hashes de contraseña, cierre de sesión, persistencia al reabrir SQLite, conflictos entre pestañas, validación de árboles, exclusión de chats temporales y limitación de intentos de acceso. Los proveedores de IA se simulan para ejecutar las pruebas sin claves ni cargos. Las pruebas de cuentas necesitan permiso para abrir conexiones HTTP locales y crean bases temporales independientes.
