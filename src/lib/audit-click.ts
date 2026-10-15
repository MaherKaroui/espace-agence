// Journalisation des clics dans audit_logs (Journal d'audit).
// Toutes les actions passent par la RPC log_event (SECURITY DEFINER) : l'auteur
// est toujours auth.uid(), le client ne peut pas usurper un autre utilisateur.
// Les actions sont préfixées « clic. » pour être filtrables et ne pas encombrer
// le compte rendu quotidien.
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const MAX_TEXTE = 2000;

export type ClicOptions = {
  entityType?: string;
  entityId?: string | null;
  severity?: "info" | "warning" | "critical";
};

/** Écrit une ligne dans le journal d'audit. Ne bloque jamais l'interface. */
export function logClic(action: string, metadata: Record<string, unknown> = {}, opts: ClicOptions = {}) {
  const uuid = opts.entityId && /^[0-9a-f-]{36}$/i.test(opts.entityId) ? opts.entityId : null;
  void Promise.resolve(
    supabase.rpc("log_event", {
      _action: `clic.${action}`,
      _entity_type: opts.entityType ?? null,
      _entity_id: uuid,
      _severity: opts.severity ?? "info",
      _metadata: {
        ...metadata,
        page: typeof window !== "undefined" ? window.location.pathname : null,
      } as any,
    } as any),
  ).catch(() => {
    // La journalisation ne doit jamais casser l'action de l'utilisateur.
  });
}

/** Journalise une saisie (recherche, filtre) une fois la frappe terminée. */
export function useLogSaisie(action: string, valeur: string, metadata: Record<string, unknown> = {}, delai = 1200) {
  const premier = useRef(true);
  const meta = JSON.stringify(metadata);
  useEffect(() => {
    if (premier.current) { premier.current = false; return; }
    const terme = valeur.trim();
    const t = setTimeout(() => logClic(action, { terme: terme || "(effacé)", ...JSON.parse(meta) }), delai);
    return () => clearTimeout(t);
  }, [action, valeur, meta, delai]);
}

/** Journalise l'ouverture d'une page (une fois par montage). */
export function useLogOuverture(action: string, metadata: Record<string, unknown> = {}) {
  const fait = useRef(false);
  useEffect(() => {
    if (fait.current) return;
    fait.current = true;
    logClic(action, metadata);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Journalise tout copier (Ctrl+C, clic droit → Copier) fait dans un bloc :
 * le texte copié et le contexte (attributs data-audit-* de l'élément le plus proche).
 * `masquer` permet de remplacer un texte sensible (mot de passe) avant écriture.
 */
export function useLogCopie<T extends HTMLElement>(
  action: string,
  contexte: () => Record<string, unknown> = () => ({}),
  masquer?: (texte: string) => string | null,
) {
  const ref = useRef<T>(null);
  const ctx = useRef(contexte);
  const msk = useRef(masquer);
  ctx.current = contexte;
  msk.current = masquer;

  // Écoute au niveau du document : le bloc peut apparaître après le montage.
  useEffect(() => {
    const onCopy = () => {
      const el = ref.current;
      const sel = window.getSelection();
      const noeud = sel?.anchorNode;
      if (!el || !noeud || !el.contains(noeud)) return;
      const brut = sel?.toString() ?? "";
      if (!brut.trim()) return;
      const masque = msk.current?.(brut);
      const texte = masque ?? brut;
      const porteur = (noeud instanceof Element ? noeud : noeud?.parentElement)?.closest<HTMLElement>("[data-audit-id]");
      const extra: Record<string, unknown> = {};
      if (porteur) {
        for (const [k, v] of Object.entries(porteur.dataset)) {
          if (k.startsWith("audit")) extra[k.slice(5, 6).toLowerCase() + k.slice(6)] = v;
        }
      }
      logClic(action, {
        ...ctx.current(),
        ...extra,
        texte_copie: texte.length > MAX_TEXTE ? `${texte.slice(0, MAX_TEXTE)}…` : texte,
        longueur: brut.length,
      }, { severity: "warning" });
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [action]);

  return ref;
}
