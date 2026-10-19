export type Lang = "en" | "es";

const dict = {
  en: {
    appName: "deisy-jobs",
    login: "Log in",
    logout: "Log out",
    email: "Email",
    password: "Password",
    magicLink: "Send magic link",
    magicSent: "Check your email",
    needsDeisy: "Needs Deisy",
    markDone: "Done",
    undoDone: "Undo",
    reply: "Reply",
    send: "Send",
    filters: "Filters",
    status: "Status",
    company: "Company",
    search: "Search company",
    from: "From",
    to: "To",
    all: "All",
    apply: "Apply",
    role: "Role",
    location: "Location",
    pay: "Pay",
    cv: "CV",
    found: "Found",
    applied: "Applied",
    notes: "Notes",
    empty: "No applications",
    loading: "Loading…",
    error: "Something went wrong",
    openLink: "Open",
    reason: "Why",
    detail: "Detail",
    author: "Author",
    parked: "Parked",
    skipped: "Skipped",
    submitted: "Submitted",
    closed: "Closed",
    foundStatus: "Found",
    todos: "Your to-dos",
    todosLede: "Open tasks that unblock one or more applications — do these first.",
    todosEmpty: "No open tasks right now.",
    snooze: "Snooze 3 days",
    due: "Due",
    application: "application",
    applications: "applications",
  },
  es: {
    appName: "deisy-jobs",
    login: "Entrar",
    logout: "Salir",
    email: "Correo",
    password: "Clave",
    magicLink: "Enlace mágico",
    magicSent: "Revisa tu correo",
    needsDeisy: "Para Deisy",
    markDone: "Listo",
    undoDone: "Deshacer",
    reply: "Responder",
    send: "Enviar",
    filters: "Filtros",
    status: "Estado",
    company: "Empresa",
    search: "Buscar empresa",
    from: "Desde",
    to: "Hasta",
    all: "Todos",
    apply: "Aplicar",
    role: "Rol",
    location: "Ubicación",
    pay: "Pago",
    cv: "CV",
    found: "Hallado",
    applied: "Aplicado",
    notes: "Notas",
    empty: "Sin aplicaciones",
    loading: "Cargando…",
    error: "Algo falló",
    openLink: "Abrir",
    reason: "Motivo",
    detail: "Detalle",
    author: "Autor",
    parked: "En pausa",
    skipped: "Omitido",
    submitted: "Enviado",
    closed: "Cerrado",
    foundStatus: "Hallado",
    todos: "Tus pendientes",
    todosLede:
      "Tareas abiertas que desbloquean una o más solicitudes — haz estas primero.",
    todosEmpty: "No hay tareas abiertas ahora.",
    snooze: "Posponer 3 días",
    due: "Vence",
    application: "solicitud",
    applications: "solicitudes",
  },
} as const;

export type DictKey = keyof (typeof dict)["en"];

export function t(lang: Lang, key: DictKey): string {
  return dict[lang][key] ?? dict.en[key];
}

export function statusLabel(lang: Lang, status: string): string {
  switch (status) {
    case "Needs-Deisy":
      return t(lang, "needsDeisy");
    case "Parked":
      return t(lang, "parked");
    case "Skipped":
      return t(lang, "skipped");
    case "Submitted":
      return t(lang, "submitted");
    case "Closed":
      return t(lang, "closed");
    case "Found":
      return t(lang, "foundStatus");
    default:
      return status;
  }
}
