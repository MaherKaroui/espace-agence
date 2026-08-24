/**
 * Assistant IA — logique serveur (lecture RLS, outils, exécution des actions).
 *
 * Règles :
 * - TOUS les outils de lecture utilisent le client Supabase porteur de l'identité
 *   de l'utilisateur connecté (`context.supabase`). Jamais `supabaseAdmin`.
 * - Le rôle est vérifié côté serveur (RPC `is_staff`) avant d'exposer / exécuter
 *   un outil réservé à l'agence.
 * - Les outils d'écriture ne écrivent rien : ils produisent une proposition qui
 *   doit être confirmée par l'utilisateur (voir `executeAssistantAction`).
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

export function buildAssistantTools(caller: AssistantCaller, proposals: AssistantProposal[]) {
  const { supabase, userId, isStaff } = caller;

  const mk = (description: string, inputSchema: any, execute: (args: any) => Promise<any>) => ({
    description,
    inputSchema,
    execute,
  });

  const tools: Record<string, any> = {
    mes_dossiers: mk(
      "Liste les dossiers accessibles à l'utilisateur connecté (id, titre, catégorie, statut).",
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
        return { dossiers: data ?? [] };
      },
    ),

    etat_dossier: mk(
      "Statut, catégorie, ancienneté et dernière action d'un dossier.",
      z.object({ dossier_id: z.string().uuid() }),
      async ({ dossier_id }: { dossier_id: string }) => {
        const { data, error } = await supabase
          .from("dossiers")
          .select(
            "id, titre, categorie, statut, avancement, organisme_nom, prochaine_action, created_at, updated_at, last_relance_at",
          )
          .eq("id", dossier_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return { trouve: false };
        const jours = Math.floor((Date.now() - new Date(data.created_at).getTime()) / 86400000);
        return { trouve: true, dossier: data, anciennete_jours: jours };
      },
    ),

    pieces_manquantes: mk(
      "Pièces demandées par l'agence et non encore déposées pour un dossier (documents sans fichier).",
      z.object({ dossier_id: z.string().uuid() }),
      async ({ dossier_id }: { dossier_id: string }) => {
        const { data, error } = await supabase
          .from("documents")
          .select("id, nom, created_at, storage_path, from_agence")
          .eq("dossier_id", dossier_id)
          .eq("from_agence", true)
          .is("storage_path", null)
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return { manquantes: (data ?? []).map((d: any) => ({ id: d.id, libelle: d.nom, demandee_le: d.created_at })) };
      },
    ),

    pieces_attendues_pour: mk(
      "Liste de référence des pièces à fournir pour une catégorie de demande (table demande_pieces_modeles). Source unique de vérité : ne jamais inventer de pièce.",
      z.object({ categorie: z.enum(CATEGORIE_VALUES) }),
      async ({ categorie }: { categorie: string }) => ({
        categorie,
        pieces: await piecesModelesFor(supabase, categorie),
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
        return { indicateurs: data ?? [] };
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
          .select("id, titre, statut, categorie, pole_id, updated_at")
          .is("archived_at", null)
          .limit(400);
        if (error) throw new Error(error.message);
        const rows = (dossiers ?? []) as any[];
        const stagnants = rows.filter((d) => d.updated_at < since && !["termine", "refuse"].includes(d.statut));
        const parPole: Record<string, number> = {};
        for (const d of rows) parPole[d.pole_id ?? "sans_pole"] = (parPole[d.pole_id ?? "sans_pole"] ?? 0) + 1;
        const { data: taches } = await supabase
          .from("agency_tasks")
          .select("id, title, due_date, status")
          .lt("due_date", new Date().toISOString())
          .neq("status", "termine")
          .is("archived_at", null)
          .limit(50);
        return {
          total_dossiers: rows.length,
          stagnants: stagnants.slice(0, 20),
          charge_par_pole: parPole,
          taches_en_retard: taches ?? [],
        };
      },
    );

    tools.historique_echanges = mk(
      "Derniers messages internes et commentaires de tâches liés à un dossier ou un client (agence uniquement).",
      z.object({ dossier_id: z.string().uuid().optional(), limite: z.number().int().min(1).max(50).default(20) }),
      async ({ dossier_id, limite }: { dossier_id?: string; limite: number }) => {
        denyClient(isStaff, "historique_echanges");
        let convQ = supabase
          .from("internal_conversations")
          .select("id, titre, dossier_id, updated_at")
          .order("updated_at", { ascending: false })
          .limit(10);
        if (dossier_id) convQ = convQ.eq("dossier_id", dossier_id);
        const { data: convs } = await convQ;
        const ids = ((convs ?? []) as any[]).map((c) => c.id);
        let messages: any[] = [];
        if (ids.length > 0) {
          const { data: msgs } = await supabase
            .from("internal_messages")
            .select("id, conversation_id, content, created_at")
            .in("conversation_id", ids)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(limite);
          messages = msgs ?? [];
        }
        const { data: comments } = await supabase
          .from("agency_task_comments")
          .select("id, task_id, content, created_at")
          .order("created_at", { ascending: false })
          .limit(limite);
        return { conversations: convs ?? [], messages, commentaires: comments ?? [] };
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
      client_id: z.string().uuid().optional().describe("Agence uniquement : client pour lequel la demande est créée"),
    }),
    async (args: any) => {
      if (!isStaff && args.client_id && args.client_id !== userId) {
        throw new Error("Accès refusé : vous ne pouvez créer une demande que pour votre propre compte.");
      }
      const pieces = await piecesModelesFor(supabase, args.categorie);
      const proposal: AssistantProposal = {
        kind: "creer_demande",
        categorie: args.categorie,
        organisme_nom: args.organisme_nom,
        description: args.description ?? null,
        pieces: pieces.map((p) => ({ libelle: p.libelle, motif: p.motif, obligatoire: p.obligatoire })),
        client_id: isStaff ? (args.client_id ?? userId) : userId,
      };
      proposals.push(proposal);
      return {
        confirmation_requise: true,
        message: "Carte de confirmation affichée à l'utilisateur. Ne rien créer avant sa validation.",
        apercu: proposal,
      };
    },
  );

  tools.demander_piece = mk(
    "Prépare l'ajout d'une pièce complémentaire à un dossier existant. N'écrit rien avant confirmation.",
    z.object({ dossier_id: z.string().uuid(), libelle: z.string().min(2), motif: z.string().optional() }),
    async (args: any) => {
      const { data: dossier, error } = await supabase
        .from("dossiers")
        .select("id, titre, client_id")
        .eq("id", args.dossier_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!dossier) throw new Error("Dossier introuvable ou inaccessible.");
      if (!isStaff && dossier.client_id !== userId) {
        throw new Error("Accès refusé : ce dossier ne vous appartient pas.");
      }
      const proposal: AssistantProposal = {
        kind: "demander_piece",
        dossier_id: dossier.id,
        dossier_titre: dossier.titre,
        libelle: args.libelle,
        motif: args.motif ?? null,
      };
      proposals.push(proposal);
      return { confirmation_requise: true, apercu: proposal };
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
        dossier_id: z.string().uuid().optional(),
      }),
      async (args: any) => {
        denyClient(isStaff, "creer_tache");
        const proposal: AssistantProposal = {
          kind: "creer_tache",
          title: args.title,
          description: args.description ?? null,
          priority: args.priority ?? "normale",
          due_date: args.due_date ?? null,
          dossier_id: args.dossier_id ?? null,
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: proposal };
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
        return { taches: data ?? [] };
      },
    );

    const loadTask = async (taskId: string) => {
      const { data, error } = await supabase
        .from("agency_tasks")
        .select("id, title, status, due_date")
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Tâche introuvable ou hors de votre périmètre.");
      return data as any;
    };

    tools.changer_statut_tache = mk(
      "Prépare le changement de statut d'une tâche. N'écrit rien avant confirmation.",
      z.object({ task_id: z.string().uuid(), statut: z.enum(TASK_STATUS_VALUES) }),
      async (args: any) => {
        denyClient(isStaff, "changer_statut_tache");
        const task = await loadTask(args.task_id);
        const proposal: AssistantProposal = {
          kind: "changer_statut_tache",
          task_id: task.id,
          task_titre: task.title,
          statut: args.statut,
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: proposal };
      },
    );

    tools.assigner_tache = mk(
      "Prépare l'assignation d'une tâche à un membre de l'équipe. N'écrit rien avant confirmation.",
      z.object({ task_id: z.string().uuid(), user_id: z.string().uuid() }),
      async (args: any) => {
        denyClient(isStaff, "assigner_tache");
        const task = await loadTask(args.task_id);
        const { data: prof } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", args.user_id)
          .maybeSingle();
        if (!prof) throw new Error("Membre introuvable ou hors de votre périmètre.");
        const proposal: AssistantProposal = {
          kind: "assigner_tache",
          task_id: task.id,
          task_titre: task.title,
          user_id: prof.id,
          user_nom: prof.full_name ?? "Membre",
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: proposal };
      },
    );

    tools.proposer_echeance_tache = mk(
      "Prépare la modification de l'échéance d'une tâche. N'écrit rien avant confirmation.",
      z.object({ task_id: z.string().uuid(), due_date: z.string().describe("ISO YYYY-MM-DD") }),
      async (args: any) => {
        denyClient(isStaff, "proposer_echeance_tache");
        const task = await loadTask(args.task_id);
        const proposal: AssistantProposal = {
          kind: "modifier_echeance_tache",
          task_id: task.id,
          task_titre: task.title,
          due_date: args.due_date,
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: proposal };
      },
    );

    tools.commenter_tache = mk(
      "Prépare l'ajout d'un commentaire interne sur une tâche. N'écrit rien avant confirmation.",
      z.object({ task_id: z.string().uuid(), contenu: z.string().min(2).max(2000) }),
      async (args: any) => {
        denyClient(isStaff, "commenter_tache");
        const task = await loadTask(args.task_id);
        const proposal: AssistantProposal = {
          kind: "commenter_tache",
          task_id: task.id,
          task_titre: task.title,
          contenu: args.contenu,
        };
        proposals.push(proposal);
        return { confirmation_requise: true, apercu: proposal };
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
      dossier_id: dossier.id,
      titre: dossier.titre,
      pieces: pieces.map((p) => ({ libelle: p.libelle, motif: p.motif, obligatoire: p.obligatoire })),
    };
  }

  if (action.kind === "demander_piece") {
    const { data: dossier } = await supabase
      .from("dossiers")
      .select("id, client_id")
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
    return { ok: true, document_id: doc.id };
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
    return { ok: true, task_id: task.id };
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
    kind: z.literal("rediger_message"),
    destinataire: z.string().nullable().optional().default(null),
    objet: z.string().nullable().optional().default(null),
    brouillon: z.string(),
  }),
]);
