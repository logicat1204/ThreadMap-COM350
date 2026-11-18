# ThreadMap

Aplicación web local en español para conversar con IA y explorar preguntas relacionadas en un árbol de ramas. Requiere Node.js 22.9 o superior y no necesita instalar dependencias.

## Ejecutar

```powershell
npm start
```

Abre [ThreadMap](http://127.0.0.1:3000). El modo demo incluye conversaciones de ejemplo y permite crear y navegar nodos. Para generar respuestas nuevas, conecta OpenAI o Gemini. Durante el desarrollo, `npm run dev` reinicia el servidor al editar sus módulos.

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
3. El mapa se abre al crear una rama. Usa el botón con forma de rama o **Ctrl+Y** para mostrarlo u ocultarlo. El botón de ampliar ocupa la página dentro del navegador y permite volver al panel.
4. Pasa el cursor sobre un nodo para ver el fragmento marcado, la rama de origen y la respuesta. Desplázate dentro de la vista previa si el contenido es largo. Con el teclado, enfoca el nodo y pulsa **↓** para entrar a la vista previa.
5. Selecciona cualquier nodo para ver su conversación. Usa los botones junto a los nodos para mostrar u ocultar sus descendientes. Puedes arrastrar el lienzo, hacer zoom, ajustarlo a la vista y redimensionar el panel en escritorio.

El historial y el tema se guardan en el navegador. Cada rama contiene únicamente sus propios mensajes y un enlace al mensaje de origen. Para construir el contexto, ThreadMap recorre sus ancestros hasta cada punto de bifurcación.

## Chat temporal

En una conversación nueva, activa **Chat temporal** antes de enviar el primer mensaje. La conversación y sus ramas se mantienen en memoria mientras estés en ese chat y se descartan al navegar a otro o recargar. Al solicitar una respuesta, el proveedor de IA seleccionado recibe el contexto de la rama.

## Pruebas

```powershell
npm test
```

Las pruebas cubren el contexto de ramas anidadas y hermanas, el colapso de nodos y la selección de credenciales y modelos para ambos proveedores. Los proveedores de IA se simulan para que las pruebas se ejecuten sin claves ni cargos.
