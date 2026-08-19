/**
 * Capture silencieuse des erreurs applicatives.
 * - erreurs JS non gérées, promesses rejetées, erreurs de rendu React
 * - erreurs réseau / Supabase (4xx, 5xx) et requêtes lentes (> 2s)
 * Jamais bloquant : toutes les écritures sont fire-and-forget.
 */
import { supabase } from "@/integrations/supabase/client";

export type Gravite = "critique" | "majeur" | "mineur";

const SLOW_MS = 5000;

/** Traitements longs par nature (IA, rapports) : ne pas signaler comme "lents". */
const SLOW_EXEMPT = [
  "supervision.functions",
  "ai-supervisor",
  "internal-ai.functions",
  "activity-reports.functions",
  "direction-report.functions",
  "classify-document.functions",
  "qualiopi.functions",
  "google-drive.functions",
  "drive-auto.functions",
];

/** Les URLs /_serverFn/<base64> encodent le module appelé : on le décode. */
function isSlowExempt(url: string): boolean {
  const marker = "/_serverFn/";
  const idx = url.indexOf(marker);
  let target = url;
  if (idx !== -1) {
    const encoded = url.slice(idx + marker.length).split(/[/?]/)[0] ?? "";
    try {
      target = atob(decodeURIComponent(encoded));
    } catch {
      target = encoded;
    }
  }
  return SLOW_EXEMPT.some((p) => target.includes(p));
}
const MAX_PER_MINUTE = 12;
let sentThisMinute = 0;
let windowStart = Date.now();
const recent = new Map<string, number>();

function throttled(key: string): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentThisMinute = 0;
  }
  if (sentThisMinute >= MAX_PER_MINUTE) return true;
  const last = recent.get(key);
  if (last && now - last < 30_000) return true;
  recent.set(key, now);
  if (recent.size > 200) recent.clear();
  sentThisMinute++;
  return false;
}

export function logAppError(input: {
  type: string;
  message: string;
  stack?: string | null;
  gravite?: Gravite;
  metadata?: Record<string, unknown>;
}) {
  try {
    if (typeof window === "undefined") return;
    const key = `${input.type}|${input.message}`.slice(0, 180);
    if (throttled(key)) return;
    const row = {
      type: input.type,
      message: String(input.message ?? "").slice(0, 2000),
      stack: input.stack ? String(input.stack).slice(0, 6000) : null,
      url_page: window.location.pathname + window.location.search,
      navigateur: navigator.userAgent.slice(0, 400),
      gravite: input.gravite ?? "majeur",
      metadata: input.metadata ?? {},
    };
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        await (supabase.from("app_errors" as any) as any).insert({
          ...row,
          user_id: data.session?.user?.id ?? null,
        });
      } catch {
        /* silencieux */
      }
    })();
  } catch {
    /* silencieux */
  }
}

let installed = false;

export function installErrorLogger() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const err = (event as ErrorEvent).error;
    logAppError({
      type: "js_error",
      message: (event as ErrorEvent).message || String(err),
      stack: err instanceof Error ? err.stack : null,
      gravite: "majeur",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    logAppError({
      type: "unhandled_rejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : null,
      gravite: "majeur",
    });
  });

  // Interception réseau (Supabase / API internes)
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = performance.now();
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    try {
      const res = await originalFetch(input as any, init);
      const ms = Math.round(performance.now() - started);
      const isApp = /supabase\.co|\/api\/|\/_serverFn\//.test(url);
      if (isApp && url.indexOf("app_errors") === -1) {
        if (res.status >= 400) {
          logAppError({
            type: res.status === 401 || res.status === 403 ? "api_forbidden" : "api_error",
            message: `${res.status} ${res.statusText} — ${url.split("?")[0]}`,
            gravite: res.status >= 500 ? "critique" : "majeur",
            metadata: { status: res.status, ms },
          });
        } else if (ms > SLOW_MS && !isSlowExempt(url)) {
          logAppError({
            type: "slow_request",
            message: `Requête lente (${ms} ms) — ${url.split("?")[0]}`,
            gravite: "mineur",
            metadata: { ms },
          });
        }
      }
      return res;
    } catch (e) {
      if (/supabase\.co|\/api\//.test(url)) {
        logAppError({
          type: "network_error",
          message: `Échec réseau — ${url.split("?")[0]}`,
          stack: e instanceof Error ? e.stack : null,
          gravite: "critique",
        });
      }
      throw e;
    }
  };
}
