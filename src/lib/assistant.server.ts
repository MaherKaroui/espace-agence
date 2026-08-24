/**
 * Assistant IA — logique serveur (lecture RLS, outils, exécution des actions).
 *
 * Règles :
 * - TOUS les outils de lecture utilisent le client Supabase porteur de l'identité
 *   de l'utilisateur connecté (`context.supabase`). Jamais `supabaseAdmin`.
 * - Le rôle est vérifié côté serveur (RPC `is_staff`) avant d'exposer / exécuter
 *   un outil réservé à l'agence.
 * - Les outils d'écriture n'écrivent rien : ils produisent une proposition qui
 *   doit être confirmée par l'utilisateur (voir `executeAssistantAction`).
 * - AUCUN identifiant technique (UUID) n'est renvoyé au modèle. Les outils
 *   renvoient des libellés lisibles + une référence courte (« D1 », « T2 »)
 *   dont la correspondance vers l'UUID reste côté serveur (`RefRegistry`).
 */
import { z } from "zod";

export const ASSISTANT_MODEL = "google/gemini-2.5-flash";

/** Catégories de dossier (enum `dossier_categorie`). */
export const CATEGORIE_VALUES = [
  "qualiopi",
  "bpf",
  "nda",
  "cfa",
  "vae",
  "edof",
  "contrats",
  "documents_administratifs",
  "juridique",
  "autres",
] as const;

const POLE_CODE_BY_CATEGORIE: Record<string, string> = {
  qualiopi: "qualiopi",
  bpf: "bpf",
  nda: "nda",
  edof: "edof",
  juridique: "juridique",
};

export const TASK_STATUS_VALUES = ["a_faire", "en_cours", "bloquee", "terminee", "en_attente"] as const;

export type AssistantProposal =
  | {
      kind: "creer_demande";
      categorie: string;
      organisme_nom: string;
      description: string | null;
      pieces: { libelle: string; motif: string | null; obligatoire: boolean }[];
      client_id?: string | null;
    }
  | { kind: "demander_piece"; dossier_id: string; dossier_titre: string; libelle: string; motif: string | null }
  | {
      kind: "creer_tache";
      title: string;
      description: string | null;
      priority: "basse" | "normale" | "haute" | "urgente";
      due_date: string | null;
      dossier_id: string | null;
    }
  | { kind: "changer_statut_tache"; task_id: string; task_titre: string; statut: string }
  | { kind: "assigner_tache"; task_id: string; task_titre: string; user_id: string; user_nom: string }
  | { kind: "modifier_echeance_tache"; task_id: string; task_titre: string; due_date: string | null }
  | { kind: "commenter_tache"; task_id: string; task_titre: string; contenu: string }
  | { kind: "rediger_message"; destinataire: string | null; objet: string | null; brouillon: string };

export type AssistantCaller = { supabase: any; userId: string; isStaff: boolean };

/* ------------------------------------------------- registre de références */

const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

type RefKind = "dossier" | "tache" | "personne" | "document" | "pole" | "conversation";

const REF_PREFIX: Record<RefKind, string> = {
  dossier: "D",
  tache: "T",
  personne: "P",
  document: "F",
  pole: "G",
  conversation: "C",
};

export type RefRegistry = {
  /** Enregistre un identifiant et renvoie sa référence courte affichable. */
  put: (kind: RefKind, id: string, label: string) => string;
  /** Retrouve l'UUID depuis une référence courte (ou un UUID déjà connu). */
  resolveId: (kind: RefKind, token: string) => string | null;
  /** Libellé connu pour un UUID (utilisé par le filet de sécurité). */
  labelFor: (id: string) => string | null;
};

export function createRefRegistry(): RefRegistry {
  const byRef = new Map<string, { kind: RefKind; id: string; label: string }>();
  const byId = new Map<string, { ref: string; label: string }>();
  const counters: Record<string, number> = {};

  return {
    put(kind, id, label) {
      const existing = byId.get(id);
      if (existing) return existing.ref;
      counters[kind] = (counters[kind] ?? 0) + 1;
      const ref = `${REF_PREFIX[kind]}${counters[kind]}`;
      byRef.set(ref, { kind, id, label });
      byId.set(id, { ref, label });
      return ref;
    },
    resolveId(kind, token) {
      const key = String(token ?? "").trim().toUpperCase();
      const hit = byRef.get(key);
      if (hit && hit.kind === kind) return hit.id;
      const raw = String(token ?? "").trim();
      if (/^[0-9a-fA-F-]{36}$/.test(raw)) return raw;
      return null;
    },
    labelFor(id) {
      return byId.get(id)?.label ?? null;
    },
  };
}

/**
 * Filet de sécurité : aucun UUID ne doit atteindre l'interface.
 * Remplacé par le libellé connu, sinon retiré.
 */
export function sanitizeAssistantText(text: string, refs: RefRegistry): string {
  if (!text) return text;
  return text
    .replace(UUID_RE, (id) => refs.labelFor(id) ?? "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** Vérifie le rôle côté serveur (fonction SECURITY DEFINER existante). */
export async function resolveCaller(supabase: any, userId: string): Promise<AssistantCaller> {
  const { data, error } = await supabase.rpc("is_staff", { _user_id: userId });
  if (error) throw new Error(error.message);
  return { supabase, userId, isStaff: data === true };
}

function denyClient(isStaff: boolean, outil: string) {
  if (!isStaff) {
    throw new Error(`Accès refusé : l'outil « ${outil} » est réservé à l'équipe de l'agence.`);
  }
}

/* ------------------------------------------------------------- libellés */

const dossierLabel = (d: any) => d?.titre?.trim() || d?.organisme_nom?.trim() || "Dossier sans titre";
const tacheLabel = (t: any) => t?.title?.trim() || "Tâche sans titre";
const personneLabel = (p: any) => {
  const nom = [p?.prenom, p?.nom].filter(Boolean).join(" ").trim() || p?.full_name?.trim() || p?.entreprise?.trim();
  return nom || "Personne sans nom";
};
const clientLabel = (p: any) => {
  const nom = p?.entreprise?.trim() || [p?.prenom, p?.nom].filter(Boolean).join(" ").trim();
  return nom || "Client sans nom";
};

async function poleIdForCategorie(supabase: any, categorie: string): Promise<string> {
  const code = POLE_CODE_BY_CATEGORIE[categorie] ?? "autres";
  const { data } = await supabase.from("poles").select("id, code").eq("actif", true).in("code", [code, "autres"]);
  const rows = (data ?? []) as { id: string; code: string }[];
  const found = rows.find((r) => r.code === code) ?? rows.find((r) => r.code === "autres");
  if (!found) throw new Error("Aucun pôle actif disponible pour créer la demande.");
  return found.id;
}

export async function piecesModelesFor(supabase: any, categorie: string) {
  const { data, error } = await supabase
    .from("demande_pieces_modeles")
    .select("libelle, motif, obligatoire, ordre")
    .eq("categorie", categorie)
    .eq("actif", true)
    .order("ordre", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { libelle: string; motif: string | null; obligatoire: boolean; ordre: number }[];
}

/* ------------------------------------------------------------------ outils */

export function buildAssistantTools(caller: AssistantCaller, proposals: AssistantProposal[], refs: RefRegistry) {
  const { supabase, userId, isStaff } = caller;

  const mk = (description: string, inputSchema: any, execute: (args: any) => Promise<any>) => ({
    description,
    inputSchema,
    execute,
  });

  const REF_DOSSIER = "Référence courte du dossier (ex : D1) renvoyée par un outil de lecture, ou nom exact du dossier / de l'organisme.";
  const REF_TACHE = "Référence courte de la tâche (ex : T1) renvoyée par `mes_taches`, ou titre exact de la tâche.";
  const REF_PERSONNE = "Référence courte de la personne (ex : P1), ou son prénom et nom.";

  /** Résout un dossier depuis une référence courte ou un nom. Renvoie {id, titre}. */
  const findDossier = async (token: string) => {
    const id = refs.resolveId("dossier", token);
    let q = supabase.from("dossiers").select("id, titre, organisme_nom, client_id").is("archived_at", null).limit(3);
    q = id ? q.eq("id", id) : q.or(`titre.ilike.%${token}%,organisme_nom.ilike.%${token}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) throw new Error(`Aucun dossier ne correspond à « ${token} ».`);
    if (rows.length > 1)
      throw new Error(
        `Plusieurs dossiers correspondent à « ${token} » : ${rows.map(dossierLabel).join(", ")}. Précisez lequel.`,
      );
    return rows[0];
  };

  const findTache = async (token: string) => {
    const id = refs.resolveId("tache", token);
    let q = supabase.from("agency_tasks").select("id, title, status, due_date").is("archived_at", null).limit(3);
    q = id ? q.eq("id", id) : q.ilike("title", `%${token}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) throw new Error(`Aucune tâche ne correspond à « ${token} » dans votre périmètre.`);
    if (rows.length > 1)
      throw new Error(`Plusieurs tâches correspondent à « ${token} » : ${rows.map(tacheLabel).join(", ")}. Précisez laquelle.`);
    return rows[0];
  };

  const findPersonne = async (token: string) => {
    const id = refs.resolveId("personne", token);
    let q = supabase.from("profiles").select("id, prenom, nom, entreprise").limit(3);
    q = id ? q.eq("id", id) : q.or(`prenom.ilike.%${token}%,nom.ilike.%${token}%,entreprise.ilike.%${token}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) throw new Error(`Aucune personne ne correspond à « ${token} ».`);
    if (rows.length > 1)
      throw new Error(`Plusieurs personnes correspondent à « ${token} » : ${rows.map(personneLabel).join(", ")}.`);
    return rows[0];
  };

  const tools: Record<string, any> = {
    mes_dossiers: mk(
      "Liste les dossiers accessibles à l'utilisateur connecté (référence courte, titre, catégorie, statut).",
      z.object({ recherche: z.string().optional().describe("Filtre texte sur le titre ou l'organisme") }),
      async ({ recherche }: { recherche?: string }) => {
        let q = supabase
          .from("dossiers")
          .select("id, titre, categorie, statut, organisme_nom, created_at, updated_at")
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(30);
        if (recherche) q = q.or(`titre.ilike.%${recherche}%,organisme_nom.ilike.%${recherche}%`);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return {
          dossiers: ((data ?? []) as any[]).map((d) => ({
            ref: refs.put("dossier", d.id, dossierLabel(d)),
            dossier: dossierLabel(d),
            organisme: d.organisme_nom?.trim() || "Organisme non renseigné",
            categorie: d.categorie,
            statut: d.statut,
            cree_le: d.created_at,
            derniere_maj: d.updated_at,
          })),
        };
      },
    ),

    etat_dossier: mk(
      "Statut, catégorie, ancienneté et dernière action d'un dossier.",
      z.object({ dossier: z.string().describe(REF_DOSSIER) }),
      async ({ dossier }: { dossier: string }) => {
        const found = await findDossier(dossier);
        const { data, error } = await supabase
          .from("dossiers")
          .select(
            "id, titre, categorie, statut, avancement, organisme_nom, prochaine_action, created_at, updated_at, last_relance_at",
          )
          .eq("id", found.id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return { trouve: false };
        const jours = Math.floor((Date.now() - new Date(data.created_at).getTime()) / 86400000);
        return {
          trouve: true,
          ref: refs.put("dossier", data.id, dossierLabel(data)),
          dossier: dossierLabel(data),
          organisme: data.organisme_nom?.trim() || "Organisme non renseigné",
          categorie: data.categorie,
          statut: data.statut,
          avancement: data.avancement,
          prochaine_action: data.prochaine_action,
          derniere_relance: data.last_relance_at,
          derniere_maj: data.updated_at,
          anciennete_jours: jours,
        };
      },
    ),

    pieces_manquantes: mk(
      "Pièces demandées par l'agence et non encore déposées pour un dossier (documents sans fichier).",
      z.object({ dossier: z.string().describe(REF_DOSSIER) }),
      async ({ dossier }: { dossier: string }) => {
        const found = await findDossier(dossier);
        const { data, error } = await supabase
          .from("documents")
          .select("id, nom, created_at, storage_path, from_agence")
          .eq("dossier_id", found.id)
          .eq("from_agence", true)
          .is("storage_path", null)
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return {
          dossier: dossierLabel(found),
          manquantes: ((data ?? []) as any[]).map((d) => ({
            piece: d.nom?.trim() || "Pièce sans intitulé",
            demandee_le: d.created_at,
          })),
        };
      },
    ),

    pieces_attendues_pour: mk(
      "Liste de référence des pièces à fournir pour une catégorie de demande (table demande_pieces_modeles). Source unique de vérité : ne jamais inventer de pièce.",
      z.object({ categorie: z.enum(CATEGORIE_VALUES) }),
      async ({ categorie }: { categorie: string }) => ({
        categorie,
        pieces: (await piecesModelesFor(supabase, categorie)).map((p) => ({
          libelle: p.libelle,
          motif: p.motif,
          obligatoire: p.obligatoire,
        })),
      }),
    ),

    referentiel_qualiopi: mk(
      "Critères et indicateurs Qualiopi enregistrés en base, pour expliquer pourquoi une pièce est demandée.",
      z.object({ recherche: z.string().optional(), indicateur: z.number().int().optional() }),
      async ({ recherche, indicateur }: { recherche?: string; indicateur?: number }) => {
        let q = supabase
          .from("qualiopi_indicators")
          .select("numero, libelle_court, description, criterion_id")
          .order("numero")
          .limit(40);
        if (indicateur) q = q.eq("numero", indicateur);
        else if (recherche) q = q.or(`libelle_court.ilike.%${recherche}%,description.ilike.%${recherche}%`);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return {
          indicateurs: ((data ?? []) as any[]).map((i) => ({
            numero: i.numero,
            libelle: i.libelle_court,
            description: i.description,
            critere: i.criterion_id,
          })),
        };
      },
    ),
  };

  if (isStaff) {
    tools.portefeuille = mk(
      "Vue agence : dossiers en retard, dossiers stagnants et charge par pôle.",
      z.object({ jours_stagnation: z.number().int().min(1).max(180).default(14) }),
      async ({ jours_stagnation }: { jours_stagnation: number }) => {
        denyClient(isStaff, "portefeuille");
        const since = new Date(Date.now() - jours_stagnation * 86400000).toISOString();
        const { data: dossiers, error } = await supabase
          .from("dossiers")
          .select("id, titre, statut, categorie, pole_id, organisme_nom, updated_at")
          .is("archived_at", null)
          .limit(400);
        if (error) throw new Error(error.message);
        const rows = (dossiers ?? []) as any[];

        const { data: polesRows } = await supabase.from("poles").select("id, nom");
        const poleNom = new Map<string, string>(((polesRows ?? []) as any[]).map((p) => [p.id, p.nom]));

        const stagnants = rows.filter((d) => d.updated_at < since && !["termine", "refuse"].includes(d.statut));
        const parPole: Record<string, number> = {};
        for (const d of rows) {
          const nom = d.pole_id ? (poleNom.get(d.pole_id) ?? "Pôle inconnu") : "Sans pôle";
          parPole[nom] = (parPole[nom] ?? 0) + 1;
        }
        const { data: taches } = await supabase
          .from("agency_tasks")
          .select("id, title, due_date, status")
          .lt("due_date", new Date().toISOString())
          .neq("status", "termine")
          .is("archived_at", null)
          .limit(50);
        return {
          total_dossiers: rows.length,
          stagnants: stagnants.slice(0, 20).map((d) => ({
            ref: refs.put("dossier", d.id, dossierLabel(d)),
            dossier: dossierLabel(d),
            statut: d.statut,
            categorie: d.categorie,
            pole: d.pole_id ? (poleNom.get(d.pole_id) ?? "Pôle inconnu") : "Sans pôle",
            derniere_maj: d.updated_at,
          })),
          charge_par_pole: parPole,
          taches_en_retard: ((taches ?? []) as any[]).map((t) => ({
            ref: refs.put("tache", t.id, tacheLabel(t)),
            tache: tacheLabel(t),
            statut: t.status,
            echeance: t.due_date,
          })),
        };
      },
    );

    tools.historique_echanges = mk(
      "Derniers messages internes et commentaires de tâches liés à un dossier (agence uniquement).",
      z.object({ dossier: z.string().optional().describe(REF_DOSSIER), limite: z.number().int().min(1).max(50).default(20) }),
      async ({ dossier, limite }: { dossier?: string; limite: number }) => {
        denyClient(isStaff, "historique_echanges");
        const found = dossier ? await findDossier(dossier) : null;
        let convQ = supabase
          .from("internal_conversations")
          .select("id, titre, dossier_id, updated_at")
          .order("updated_at", { ascending: false })
          .limit(10);
        if (found) convQ = convQ.eq("dossier_id", found.id);
        const { data: convs } = await convQ;
        const convRows = (convs ?? []) as any[];
        const titreParConv = new Map<string, string>(
          convRows.map((c) => [c.id, c.titre?.trim() || "Conversation sans titre"]),
        );
        const ids = convRows.map((c) => c.id);
        let messages: any[] = [];
        if (ids.length > 0) {
          const { data: msgs } = await supabase
            .from("internal_messages")
            .select("id, conversation_id, content, created_at")
            .in("conversation_id", ids)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(limite);
          messages = ((msgs ?? []) as any[]).map((m) => ({
            conversation: titreParConv.get(m.conversation_id) ?? "Conversation sans titre",
            contenu: m.content,
            le: m.created_at,
          }));
        }
        const { data: comments } = await supabase
          .from("agency_task_comments")
          .select("id, task_id, content, created_at")
          .order("created_at", { ascending: false })
          .limit(limite);
        const commentRows = (comments ?? []) as any[];
        const taskIds = [...new Set(commentRows.map((c) => c.task_id))];
        const titreParTache = new Map<string, string>();
        if (taskIds.length > 0) {
          const { data: tasks } = await supabase.from("agency_tasks").select("id, title").in("id", taskIds);
          for (const t of (tasks ?? []) as any[]) titreParTache.set(t.id, tacheLabel(t));
        }
        return {
          dossier: found ? dossierLabel(found) : null,
          conversations: convRows.map((c) => ({
            conversation: c.titre?.trim() || "Conversation sans titre",
            derniere_maj: c.updated_at,
          })),
          messages,
          commentaires: commentRows.map((c) => ({
            tache: titreParTache.get(c.task_id) ?? "Tâche sans titre",
            contenu: c.content,
            le: c.created_at,
          })),
        };
      },
    );
  }

  /* ----------------------------------------------- outils d'écriture (proposition) */

  tools.creer_demande = mk(
    "Prépare la création d'une demande (dossier) et des pièces attendues. N'écrit rien : produit une carte de confirmation.",
    z.object({
      categorie: z.enum(CATEGORIE_VALUES),
      organisme_nom: z.string().min(2).describe("Nom de l'organisme de formation concerné"),
      description: z.string().optional(),
      client: z.string().optional().describe(`Agence uniquement : ${REF_PERSONNE}`),
    }),
    async (args: any) => {
      let clientId = userId;
      let clientNom: string | null = null;
      if (args.client) {
        if (!isStaff) throw new Error("Accès refusé : vous ne pouvez créer une demande que pour votre propre compte.");
        const p = await findPersonne(args.client);
        clientId = p.id;
        clientNom = clientLabel(p);
      }
      const pieces = await piecesModelesFor(supabase, args.categorie);
      const proposal: AssistantProposal = {
        kind: "creer_demande",
        categorie: args.categorie,
        organisme_nom: args.organisme_nom,
        description: args.description ?? null,
        pieces: pieces.map((p) => ({ libelle: p.libelle, motif: p.motif, obligatoire: p.obligatoire })),
        client_id: clientId,
      };
      proposals.push(proposal);
      return {
        confirmation_requise: true,
        message: "Carte de confirmation affichée à l'utilisateur. Ne rien créer avant sa validation.",
        apercu: {
          categorie: proposal.categorie,
          organisme: proposal.organisme_nom,
          client: clientNom ?? "Vous-même",
          pieces: proposal.pieces.map((p) => p.libelle),
        },
      };
    },
  );

  tools.demander_piece = mk(
    "Prépare l'ajout d'une pièce complémentaire à un dossier existant. N'écrit rien avant confirmation.",
    z.object({ dossier: z.string().describe(REF_DOSSIER), libelle: z.string().min(2), motif: z.string().optional() }),
    async (args: any) => {
      const dossier = await findDossier(args.dossier);
      if (!isStaff && dossier.client_id !== userId) {
        throw new Error("Accès refusé : ce dossier ne vous appartient pas.");
      }
      const proposal: AssistantProposal = {
        kind: "demander_piece",
        dossier_id: dossier.id,
        dossier_titre: dossierLabel(dossier),
        libelle: args.libelle,
        motif: args.motif ?? null,
      };
      proposals.push(proposal);
      return {
        confirmation_requise: true,
        apercu: { dossier: dossierLabel(dossier), piece: args.libelle, motif: args.motif ?? null },
      };
    },
  );

  if (isStaff) {
    tools.creer_tache = mk(
      "Prépare la création d'une tâche agence. N'écrit rien avant confirmation. Agence uniquement.",
      z.object({
        title: z.string().min(2).max(200),
        description: z.string().optional(),
        priority: z.enum(["basse", "normale", "haute", "urgente"]).default("normale"),
        due_date: z.string().optional().describe("ISO YYYY-MM-DD"),
        dossier: z.string().optional().describe(REF_DOSSIER),
      }),
      async (args: any) => {
        denyClient(isStaff, "creer_tache");
        const dossier = args.dossier ? await findDossier(args.dossier) : null;
        const proposal: AssistantProposal = {
          kind: "creer_tache",
          title: args.title,
          description: args.description ?? null,
          priority: args.priority ?? "normale",
          due_date: args.due_date ?? null,
          dossier_id: dossier ? dossier.id : null,
        };
        proposals.push(proposal);
        return {
          confirmation_requise: true,
          apercu: {
            tache: proposal.title,
            priorite: proposal.priority,
            echeance: proposal.due_date,
            dossier: dossier ? dossierLabel(dossier) : null,
          },
        };
      },
    );

    /** Lecture des tâches — client utilisateur : le cloisonnement par pôle vient des RLS. */
    tools.mes_taches = mk(
      "Liste les tâches agence visibles par l'utilisateur (RLS : ses tâches, celles de son pôle). Filtres : mine, statut, en_retard, echeance_avant.",
      z.object({
        mine: z.boolean().optional().describe("Uniquement les tâches assignées à l'utilisateur"),
        statut: z.enum(TASK_STATUS_VALUES).optional(),
        en_retard: z.boolean().optional(),
        echeance_avant: z.string().optional().describe("ISO YYYY-MM-DD"),
        recherche: z.string().optional(),
        limite: z.number().int().min(1).max(50).default(25),
      }),
      async (args: any) => {
        denyClient(isStaff, "mes_taches");
        let ids: string[] | null = null;
        if (args.mine) {
          const { data: links } = await supabase.from("agency_task_assignees").select("task_id").eq("user_id", userId);
          ids = ((links ?? []) as any[]).map((l) => l.task_id);
        }
        let q = supabase
          .from("agency_tasks")
          .select("id, title, status, priority, due_date, assigned_to, pole_id, dossier_id, updated_at")
          .is("archived_at", null)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(args.limite ?? 25);
        if (args.mine) {
          const orIds = (ids ?? []).length > 0 ? `,id.in.(${(ids ?? []).join(",")})` : "";
          q = q.or(`assigned_to.eq.${userId}${orIds}`);
        }
        if (args.statut) q = q.eq("status", args.statut);
        if (args.recherche) q = q.ilike("title", `%${args.recherche}%`);
        if (args.en_retard) q = q.lt("due_date", new Date().toISOString().slice(0, 10)).neq("status", "terminee");
        if (args.echeance_avant) q = q.lte("due_date", args.echeance_avant);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as any[];

        // Résolution des identifiants en libellés (assigné, pôle, dossier).
        const userIds = [...new Set(rows.map((t) => t.assigned_to).filter(Boolean))];
        const poleIds = [...new Set(rows.map((t) => t.pole_id).filter(Boolean))];
        const dossierIds = [...new Set(rows.map((t) => t.dossier_id).filter(Boolean))];
        const nomParUser = new Map<string, string>();
        const nomParPole = new Map<string, string>();
        const nomParDossier = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: profs } = await supabase.from("profiles").select("id, prenom, nom, entreprise").in("id", userIds);
          for (const p of (profs ?? []) as any[]) nomParUser.set(p.id, personneLabel(p));
        }
        if (poleIds.length > 0) {
          const { data: poles } = await supabase.from("poles").select("id, nom").in("id", poleIds);
          for (const p of (poles ?? []) as any[]) nomParPole.set(p.id, p.nom ?? "Pôle sans nom");
        }
        if (dossierIds.length > 0) {
          const { data: doss } = await supabase.from("dossiers").select("id, titre, organisme_nom").in("id", dossierIds);
          for (const d of (doss ?? []) as any[]) nomParDossier.set(d.id, dossierLabel(d));
        }

        return {
          taches: rows.map((t) => ({
            ref: refs.put("tache", t.id, tacheLabel(t)),
            tache: tacheLabel(t),
            statut: t.status,
            priorite: t.priority,
            echeance: t.due_date,
            assignee_a: t.assigned_to ? (nomParUser.get(t.assigned_to) ?? "Personne sans nom") : "Non assignée",
            pole: t.pole_id ? (nomParPole.get(t.pole_id) ?? "Pôle inconnu") : "Sans pôle",
            dossier: t.dossier_id ? (nomParDossier.get(t.dossier_id) ?? "Dossier sans titre") : null,
            derniere_maj: t.updated_at,
          })),
        };
      },
    );

    tools.changer_statut_tache = mk(
      "Prépare le changement de statut d'une tâche. N'écrit rien avant confirmation.",
      z.object({ tache: z.string().describe(REF_TACHE), statut: z.enum(TASK_STATUS_VALUES) }),
      async (args: any) => {
        denyClient(isStaff, "changer_statut_tache");
        const task = await findTache(args.tache);
        const proposal: AssistantProposal = {
          kind: "changer_statut_tache",
          task_id: task.id,
          task_titre: tacheLabel(task),
          statut: args.statut,
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: { tache: tacheLabel(task), nouveau_statut: args.statut } };
      },
    );

    tools.assigner_tache = mk(
      "Prépare l'assignation d'une tâche à un membre de l'équipe. N'écrit rien avant confirmation.",
      z.object({ tache: z.string().describe(REF_TACHE), personne: z.string().describe(REF_PERSONNE) }),
      async (args: any) => {
        denyClient(isStaff, "assigner_tache");
        const task = await findTache(args.tache);
        const prof = await findPersonne(args.personne);
        const proposal: AssistantProposal = {
          kind: "assigner_tache",
          task_id: task.id,
          task_titre: tacheLabel(task),
          user_id: prof.id,
          user_nom: personneLabel(prof),
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: { tache: tacheLabel(task), assignee_a: personneLabel(prof) } };
      },
    );

    tools.proposer_echeance_tache = mk(
      "Prépare la modification de l'échéance d'une tâche. N'écrit rien avant confirmation.",
      z.object({ tache: z.string().describe(REF_TACHE), due_date: z.string().describe("ISO YYYY-MM-DD") }),
      async (args: any) => {
        denyClient(isStaff, "proposer_echeance_tache");
        const task = await findTache(args.tache);
        const proposal: AssistantProposal = {
          kind: "modifier_echeance_tache",
          task_id: task.id,
          task_titre: tacheLabel(task),
          due_date: args.due_date,
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: { tache: tacheLabel(task), nouvelle_echeance: args.due_date } };
      },
    );

    tools.commenter_tache = mk(
      "Prépare l'ajout d'un commentaire interne sur une tâche. N'écrit rien avant confirmation.",
      z.object({ tache: z.string().describe(REF_TACHE), contenu: z.string().min(2).max(2000) }),
      async (args: any) => {
        denyClient(isStaff, "commenter_tache");
        const task = await findTache(args.tache);
        const proposal: AssistantProposal = {
          kind: "commenter_tache",
          task_id: task.id,
          task_titre: tacheLabel(task),
          contenu: args.contenu,
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: { tache: tacheLabel(task), commentaire: args.contenu } };
      },
    );

    tools.rediger_message = mk(
      "Produit un brouillon de message. À n'appeler QUE si l'utilisateur demande explicitement d'écrire à quelqu'un, en indiquant le destinataire ET le sujet. Jamais par déduction, jamais après une simple salutation. N'envoie jamais.",
      z.object({ destinataire: z.string().optional(), objet: z.string().optional(), brouillon: z.string().min(5) }),

      async (args: any) => {
        denyClient(isStaff, "rediger_message");
        const proposal: AssistantProposal = {
          kind: "rediger_message",
          destinataire: args.destinataire ?? null,
          objet: args.objet ?? null,
          brouillon: args.brouillon,
        };
        proposals.push(proposal);
        return { confirmation_requise: false, brouillon: args.brouillon };
      },
    );
  }

  return tools;
}

/* ------------------------------------------------------------------ prompt */

export function assistantSystemPrompt(isStaff: boolean) {
  const commun = [
    "Tu es l'assistant IZISuivis, spécialisé dans le suivi des dossiers de conformité (Qualiopi, NDA, EDOF, BPF, juridique).",
    "Réponds en français, phrases courtes et concrètes. Pas de blabla, pas de listes interminables.",
    "N'écris jamais d'identifiant technique dans tes réponses (UUID, référence interne du type D1 ou T2). Désigne toujours les éléments par leur nom : nom du client, titre du dossier, titre de la tâche, prénom et nom de la personne, nom du pôle.",
    "Les références courtes (D1, T2, P3) servent uniquement à rappeler un élément dans un appel d'outil : elles ne doivent jamais apparaître dans ton texte.",
    "Si la demande n'appelle pas clairement une action, réponds simplement, sans appeler d'outil. Ne devine jamais une intention d'écriture.",
    "Une salutation, un remerciement ou une question générale se répondent en texte seul : aucun outil, aucune carte de confirmation.",
    "N'appelle un outil que si l'utilisateur exprime une intention claire et identifiable. En cas de doute, pose une question au lieu d'agir.",
    "`rediger_message` ne s'appelle que si l'utilisateur demande explicitement d'écrire à quelqu'un, en précisant le destinataire et le sujet.",
    "Tu ne vois que les données que la base autorise pour cet utilisateur (cloisonnement par pôle). Ne cherche jamais à le contourner et n'en parle pas.",
    "Tu ne connais RIEN par toi-même : toute information vient des outils. Si un outil ne renvoie pas l'information, dis clairement que tu ne sais pas et propose de transmettre la question à l'équipe.",
    "N'invente JAMAIS une liste de pièces à fournir : utilise exclusivement l'outil `pieces_attendues_pour`. N'extrapole jamais sur un sujet réglementaire.",
    "Cite toujours ta source : nom du dossier, nom du document, numéro d'indicateur Qualiopi.",
    "Quand une information te manque pour agir, pose UNE seule question à la fois.",
    "Pour toute action d'écriture, appelle l'outil correspondant : il affiche une carte de confirmation. Annonce simplement que la carte est affichée et attends la validation. Ne prétends jamais qu'une création a été effectuée.",
  ];
  const role = isStaff
    ? "Tu t'adresses à un membre de l'agence : tutoiement possible, ton direct et opérationnel."
    : "Tu t'adresses à un client : vouvoiement, ton clair et rassurant. Tu n'as accès qu'à ses propres dossiers.";
  return [...commun, role].join("\n");
}

/* -------------------------------------------------------------- exécution */

export async function executeAssistantAction(caller: AssistantCaller, action: AssistantProposal) {
  const { supabase, userId, isStaff } = caller;

  const audit = async (entityType: string, entityId: string | null, metadata: Record<string, unknown>) => {
    await supabase.rpc("log_event", {
      _action: `assistant_ia_${action.kind}`,
      _entity_type: entityType,
      _entity_id: entityId,
      _severity: "info",
      _metadata: { source: "assistant_ia", valide_par: userId, ...metadata },
    });
  };

  if (action.kind === "creer_demande") {
    const clientId = isStaff ? (action.client_id ?? userId) : userId;
    const poleId = await poleIdForCategorie(supabase, action.categorie);
    const { data: dossier, error } = await supabase
      .from("dossiers")
      .insert({
        client_id: clientId,
        categorie: action.categorie,
        pole_id: poleId,
        organisme_nom: action.organisme_nom,
        titre: action.organisme_nom,
        description: action.description,
        statut: "en_attente",
      })
      .select("id, titre")
      .single();
    if (error) throw new Error(error.message);

    const pieces = await piecesModelesFor(supabase, action.categorie);
    if (pieces.length > 0) {
      const { error: docErr } = await supabase.from("documents").insert(
        pieces.map((p) => ({
          dossier_id: dossier.id,
          uploader_id: userId,
          nom: p.libelle,
          storage_path: null,
          from_agence: true,
        })),
      );
      if (docErr) throw new Error(docErr.message);
    }
    await audit("dossier", dossier.id, { categorie: action.categorie, pieces: pieces.length });
    return {
      ok: true,
      titre: dossierLabel(dossier),
      pieces: pieces.map((p) => ({ libelle: p.libelle, motif: p.motif, obligatoire: p.obligatoire })),
    };
  }

  if (action.kind === "demander_piece") {
    const { data: dossier } = await supabase
      .from("dossiers")
      .select("id, titre, client_id")
      .eq("id", action.dossier_id)
      .maybeSingle();
    if (!dossier) throw new Error("Dossier introuvable ou inaccessible.");
    if (!isStaff && dossier.client_id !== userId) throw new Error("Accès refusé.");
    const { data: doc, error } = await supabase
      .from("documents")
      .insert({
        dossier_id: action.dossier_id,
        uploader_id: userId,
        nom: action.libelle,
        storage_path: null,
        from_agence: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit("document", doc.id, { dossier_id: action.dossier_id, libelle: action.libelle });
    return { ok: true, titre: dossierLabel(dossier), piece: action.libelle };
  }

  if (action.kind === "creer_tache") {
    if (!isStaff) throw new Error("Accès refusé : création de tâche réservée à l'agence.");
    const { data: task, error } = await supabase
      .from("agency_tasks")
      .insert({
        title: action.title,
        description: action.description,
        priority: action.priority,
        due_date: action.due_date,
        dossier_id: action.dossier_id,
        created_by: userId,
        status: "a_faire",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit("agency_task", task.id, { title: action.title });
    return { ok: true, titre: action.title };
  }

  if (
    action.kind === "changer_statut_tache" ||
    action.kind === "assigner_tache" ||
    action.kind === "modifier_echeance_tache" ||
    action.kind === "commenter_tache"
  ) {
    if (!isStaff) throw new Error("Accès refusé : gestion des tâches réservée à l'agence.");

    if (action.kind === "commenter_tache") {
      const { data: c, error } = await supabase
        .from("agency_task_comments")
        .insert({ task_id: action.task_id, user_id: userId, content: action.contenu })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await audit("agency_task", action.task_id, { commentaire_id: c.id });
      return { ok: true, titre: action.task_titre || "Tâche sans titre" };
    }

    const patch: Record<string, unknown> = { updated_by: userId };
    if (action.kind === "changer_statut_tache") {
      patch.status = action.statut;
      patch.completed_at = action.statut === "terminee" ? new Date().toISOString() : null;
    }
    if (action.kind === "assigner_tache") patch.assigned_to = action.user_id;
    if (action.kind === "modifier_echeance_tache") patch.due_date = action.due_date;

    const { error } = await supabase.from("agency_tasks").update(patch).eq("id", action.task_id);
    if (error) throw new Error(error.message);

    if (action.kind === "assigner_tache") {
      await supabase
        .from("agency_task_assignees")
        .upsert({ task_id: action.task_id, user_id: action.user_id, added_by: userId }, { onConflict: "task_id,user_id" });
    }
    await audit("agency_task", action.task_id, patch);
    return { ok: true, titre: action.task_titre || "Tâche sans titre" };
  }

  throw new Error("Cette action ne nécessite aucune exécution.");
}

export const proposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("creer_demande"),
    categorie: z.enum(CATEGORIE_VALUES),
    organisme_nom: z.string().min(2),
    description: z.string().nullable().optional().default(null),
    pieces: z
      .array(z.object({ libelle: z.string(), motif: z.string().nullable(), obligatoire: z.boolean() }))
      .default([]),
    client_id: z.string().uuid().nullable().optional(),
  }),
  z.object({
    kind: z.literal("demander_piece"),
    dossier_id: z.string().uuid(),
    dossier_titre: z.string().default(""),
    libelle: z.string().min(2),
    motif: z.string().nullable().optional().default(null),
  }),
  z.object({
    kind: z.literal("creer_tache"),
    title: z.string().min(2),
    description: z.string().nullable().optional().default(null),
    priority: z.enum(["basse", "normale", "haute", "urgente"]).default("normale"),
    due_date: z.string().nullable().optional().default(null),
    dossier_id: z.string().uuid().nullable().optional().default(null),
  }),
  z.object({
    kind: z.literal("changer_statut_tache"),
    task_id: z.string().uuid(),
    task_titre: z.string().default(""),
    statut: z.enum(TASK_STATUS_VALUES),
  }),
  z.object({
    kind: z.literal("assigner_tache"),
    task_id: z.string().uuid(),
    task_titre: z.string().default(""),
    user_id: z.string().uuid(),
    user_nom: z.string().default(""),
  }),
  z.object({
    kind: z.literal("modifier_echeance_tache"),
    task_id: z.string().uuid(),
    task_titre: z.string().default(""),
    due_date: z.string().nullable().optional().default(null),
  }),
  z.object({
    kind: z.literal("commenter_tache"),
    task_id: z.string().uuid(),
    task_titre: z.string().default(""),
    contenu: z.string().min(2),
  }),
  z.object({
    kind: z.literal("rediger_message"),
    destinataire: z.string().nullable().optional().default(null),
    objet: z.string().nullable().optional().default(null),
    brouillon: z.string(),
  }),
]);
