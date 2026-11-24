export function message(role, content, reference = null) {
  return { id: crypto.randomUUID(), role, content, reference, createdAt: new Date().toISOString() };
}

export function createThread() {
  const root = { id: crypto.randomUUID(), parentId: null, originMessageId: null, excerpt: null, messages: [], createdAt: new Date().toISOString() };
  return { id: crypto.randomUUID(), rootId: root.id, title: 'Nueva conversación', branches: { [root.id]: root }, updatedAt: root.createdAt };
}

export function persistentWorkspace({ threads, threadId, branchId }) {
  const persistent = threads.filter((thread) => !thread.temporary && thread.branches[thread.rootId].messages.length > 0);
  const active = persistent.find((thread) => thread.id === threadId);
  return {
    threads: persistent,
    threadId: active?.id ?? persistent[0]?.id ?? null,
    branchId: active?.branches[branchId]?.id ?? active?.rootId ?? persistent[0]?.rootId ?? null,
  };
}

export function createBranch(thread, parentId, originMessageId, excerpt, question, excerptRange = null) {
  const anchor = thread.branches[parentId]?.messages.find((entry) => entry.id === originMessageId);
  if (!anchor) throw new Error('El mensaje de origen no pertenece a esa rama.');
  const branch = {
    id: crypto.randomUUID(), parentId, originMessageId, excerpt, excerptRange,
    messages: [message('user', question, excerpt)],
    createdAt: new Date().toISOString(),
  };
  thread.branches[branch.id] = branch;
  return branch;
}

export function lineage(thread, branchId) {
  const result = [];
  for (let current = thread.branches[branchId]; current; current = thread.branches[current.parentId]) {
    result.unshift(current);
  }
  return result;
}

export function contextFor(thread, branchId) {
  const path = lineage(thread, branchId);
  return path.flatMap((branch, index) => {
    const child = path[index + 1];
    const limit = child ? branch.messages.findIndex((entry) => entry.id === child.originMessageId) + 1 : branch.messages.length;
    return branch.messages.slice(0, limit).map((entry) => ({ ...entry, branchId: branch.id, inherited: Boolean(child) }));
  });
}

export function modelInput(thread, branchId) {
  return contextFor(thread, branchId).map(({ role, content, reference }) => ({
    role,
    content: reference ? `Fragmento de referencia:\n“${reference}”\n\nPregunta:\n${content}` : content,
  }));
}

export function branchTitle(branch) {
  return branch?.messages[0]?.content ?? 'Nueva conversación';
}

export function branchPreview(thread, branchId) {
  const branch = thread.branches[branchId];
  const parent = thread.branches[branch.parentId];
  const source = parent?.messages.find((entry) => entry.id === branch.originMessageId);
  return {
    question: branchTitle(branch),
    excerpt: branch.excerpt,
    origin: source ? { question: branchTitle(parent), role: source.role, content: source.content } : null,
    answer: branch.messages.find((entry) => entry.role === 'assistant')?.content ?? null,
  };
}

export function rankChildren(thread, collapsed) {
  const children = new Map();
  for (const branch of Object.values(thread.branches)) {
    if (branch.parentId) {
      if (!children.has(branch.parentId)) children.set(branch.parentId, []);
      children.get(branch.parentId).push(branch.id);
    }
  }
  const nodes = [];
  const links = [];
  let nextRow = 0;
  function place(id, depth) {
    const childIds = children.get(id) ?? [];
    const visible = collapsed.has(id) ? [] : childIds;
    const positions = visible.map((childId) => place(childId, depth + 1));
    const row = positions.length ? (positions[0] + positions.at(-1)) / 2 : nextRow++;
    nodes.push({ id, depth, row, hasChildren: childIds.length > 0 });
    links.push(...visible.map((childId) => ({ from: id, to: childId })));
    return row;
  }
  place(thread.rootId, 0);
  nodes.sort((first, second) => first.depth - second.depth || first.row - second.row);
  return { nodes, links, rows: nextRow };
}

const osiAnswer = `El **modelo OSI** es un marco de referencia que describe cómo viaja la información entre dos dispositivos a través de una red. Divide ese proceso en **siete capas**, cada una con una función específica.

### Las siete capas del modelo OSI

1. **Física** — Transmite bits mediante señales eléctricas, ópticas o de radio.
2. **Enlace de datos** — Organiza los bits en tramas y comunica dispositivos de una red local.
3. **Red** — Determina la ruta que siguen los paquetes entre redes. Aquí opera IP.
4. **Transporte** — Gestiona la entrega de datos entre aplicaciones. Aquí operan TCP y UDP.
5. **Sesión** — Establece, mantiene y cierra sesiones de comunicación.
6. **Presentación** — Adapta el formato de los datos para que ambos extremos puedan interpretarlos.
7. **Aplicación** — Proporciona servicios de red a aplicaciones, como HTTP y DNS.

**¿Para qué sirve?** El modelo ayuda a entender cómo colaboran los protocolos y a localizar un fallo preguntando en qué capa ocurre.`;

function sample(title, question, answer, daysAgo) {
  const thread = createThread();
  thread.title = title;
  thread.updatedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  thread.branches[thread.rootId].messages.push(message('user', question), message('assistant', answer));
  return thread;
}

export function seedThreads() {
  const networks = sample('Fundamentos de redes', '¿Qué es el modelo OSI y para qué sirve?', osiAnswer, 0);
  const root = networks.branches[networks.rootId];
  const anchor = root.messages[1].id;
  const transport = createBranch(networks, root.id, anchor, 'Aquí operan TCP y UDP.', '¿En qué se diferencian TCP y UDP?');
  transport.messages.push(message('assistant', '### TCP y UDP\n\n**TCP** establece una conexión y vuelve a enviar datos que se pierden. Es útil cuando necesitas recibir todos los datos en orden, como al descargar un archivo.\n\n**UDP** envía datagramas sin establecer una conexión. Es útil cuando prefieres baja latencia, como en una llamada de voz.'));
  const routing = createBranch(networks, root.id, anchor, 'Determina la ruta que siguen los paquetes entre redes.', '¿Cómo funciona el enrutamiento IP?');
  routing.messages.push(message('assistant', 'Los routers consultan una **tabla de enrutamiento** para decidir adónde enviar cada paquete. Buscan la ruta más específica que coincide con la dirección de destino y lo reenvían hacia el siguiente salto.'));
  const protocols = createBranch(networks, root.id, anchor, 'como HTTP y DNS.', '¿Qué hacen HTTP y DNS?');
  protocols.messages.push(message('assistant', '**DNS** resuelve un nombre de dominio en registros, como las direcciones IP de un sitio. **HTTP** define cómo el navegador solicita recursos y cómo el servidor los entrega.'));
  const examples = createBranch(networks, transport.id, transport.messages[1].id, 'como en una llamada de voz.', '¿Por qué se usa UDP en llamadas?');
  examples.messages.push(message('assistant', 'En una llamada, un paquete de audio tardío aporta poco valor. UDP permite que la aplicación siga reproduciendo audio sin esperar una retransmisión.'));
  const reliability = createBranch(networks, transport.id, transport.messages[1].id, 'vuelve a enviar datos que se pierden.', '¿Cómo recupera TCP los datos?');
  reliability.messages.push(message('assistant', 'TCP numera los bytes y el receptor confirma lo que ha recibido. Cuando falta una confirmación o el emisor detecta un hueco, envía de nuevo los datos correspondientes.'));
  return [
    networks,
    sample('Introducción a bases de datos', '¿Qué es una base de datos relacional?', 'Organiza información en **tablas** con filas y columnas. Las claves primarias identifican filas y las claves foráneas relacionan una tabla con otra.', 1),
    sample('Ideas para mi proyecto final', '¿Cómo puedo estructurar mi proyecto final?', 'Empieza por el problema y la audiencia. Luego define un **prototipo pequeño**, un criterio de éxito y los pasos para demostrar el resultado.', 2),
  ];
}
