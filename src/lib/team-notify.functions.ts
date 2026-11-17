import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CATEGORIE_LABELS: Record<string, string> = {
  qualiopi: "Qualiopi", ndc: "NDA", rncp: "RNCP", cpf: "CPF", datadock: "Datadock", autre: "Autre",
};
const STATUT_LABELS: Record<string, string> = {
  nouveau: "Nouveau", en_attente: "En attente", documents_manquants: "Documents manquants",
  en_cours_etude: "En cours d'étude", en_cours_traitement: "En cours de traitement",
  a_completer: "À compléter", valide: "Validé", refuse: "Refusé", termine: "Terminé", annule: "Annulé",
};

/**
 * Notifie par e-mail l'équipe agence (membres du pôle + admins + direction) :
 *  - nouveau_dossier / document_depose : l'appelant doit voir le dossier (RLS)
 *  - client_message : l'appelant est le client lui-même ou un membre du staff
 *
 * Les destinataires sont résolus ET les e-mails envoyés côté serveur : aucune
 * adresse n'est renvoyée au navigateur. Les comptes archivés sont exclus.
 */
export const notifyTeamFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .discriminatedUnion("event", [
        z.object({ event: z.literal("nouveau_dossier"), dossierId: z.string().uuid() }),
        z.object({
          event: z.literal("document_depose"),
          dossierId: z.string().uuid(),
          documentNom: z.string().max(300).optional(),
        }),
        z.object({
          event: z.literal("client_message"),
          clientId: z.string().uuid(),
          extrait: z.string().max(500).optional(),
        }),
      ])
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendAppEmail } = await import("./email/send.server");
    const { APP_URL } = await import("./app-url");

    let clientId: string;
    let poleIds: string[] = [];
    let poleName: string | null = null;
    let dossier: { titre: string | null; categorie: string | null; statut: string | null } | null = null;

    if (data.event === "client_message") {
      clientId = data.clientId;
      // Autorisation : le client lui-même ou un membre du staff
      if (userId !== clientId) {
        const { data: myRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
        const isStaff = !!myRoles?.some((r: any) => r.role !== "client");
        if (!isStaff) throw new Error("Accès refusé");
      }
      // Pôles des dossiers du client
      const { data: dossiers } = await supabaseAdmin
        .from("dossiers")
        .select("pole_id")
        .eq("client_id", clientId);
      poleIds = Array.from(new Set((dossiers ?? []).map((d: any) => d.pole_id).filter(Boolean)));
    } else {
      // Lecture RLS avec le client de l'utilisateur : autorise + donne le pôle
      const { data: d } = await supabase
        .from("dossiers")
        .select("id, titre, categorie, statut, client_id, pole_id")
        .eq("id", data.dossierId)
        .maybeSingle();
      if (!d) return { ok: true as const, sent: 0 };
      clientId = d.client_id;
      dossier = { titre: d.titre, categorie: d.categorie, statut: d.statut };
      if (d.pole_id) {
        poleIds = [d.pole_id];
        const { data: pole } = await supabaseAdmin.from("poles").select("nom").eq("id", d.pole_id).maybeSingle();
        poleName = pole?.nom ?? null;
      }
    }

    let memberIds: string[] = [];
    if (poleIds.length > 0) {
      const { data: members } = await supabaseAdmin
        .from("pole_members")
        .select("user_id")
        .in("pole_id", poleIds);
      memberIds = (members ?? []).map((m: any) => m.user_id);
    }

    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "direction"] as any);
    const adminIds = (adminRoles ?? []).map((r: any) => r.user_id);

    const ids = Array.from(new Set([...memberIds, ...adminIds])).filter((id) => {
      if (!id || id === clientId) return false;
      // Message client : on n'écrit pas à l'expéditeur lui-même
      return data.event === "client_message" ? id !== userId : true;
    });
    if (ids.length === 0) return { ok: true as const, sent: 0 };

    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("email, archived_at")
      .in("id", ids);
    const emails = Array.from(
      new Set(
        ((profs ?? []) as any[]).filter((p) => !p.archived_at && p.email).map((p) => p.email as string),
      ),
    );
    if (emails.length === 0) return { ok: true as const, sent: 0 };

    const { data: clientProfile } = await supabase
      .from("profiles")
      .select("prenom, nom, email")
      .eq("id", clientId)
      .maybeSingle();
    const clientName =
      `${clientProfile?.prenom ?? ""} ${clientProfile?.nom ?? ""}`.trim() || clientProfile?.email || "Client";

    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));

    const build = (email: string) => {
      if (data.event === "nouveau_dossier") {
        return {
          templateName: "team-nouveau-dossier",
          idempotencyKey: `team-new-dossier-${data.dossierId}-${email}-${bucket}`,
          templateData: {
            clientName,
            clientEmail: clientProfile?.email ?? undefined,
            dossierTitre: dossier?.titre ?? undefined,
            categorie: dossier?.categorie ? (CATEGORIE_LABELS[dossier.categorie] ?? dossier.categorie) : undefined,
            poleName: poleName ?? undefined,
            statut: dossier?.statut ? (STATUT_LABELS[dossier.statut] ?? dossier.statut) : undefined,
            dossierId: data.dossierId,
            appUrl: APP_URL,
          },
        };
      }
      if (data.event === "document_depose") {
        return {
          templateName: "team-document-depose",
          idempotencyKey: `team-doc-${data.dossierId}-${email}-${bucket}`,
          templateData: {
            clientName,
            dossierTitre: dossier?.titre ?? undefined,
            documentNom: data.documentNom,
            poleName: poleName ?? undefined,
            dossierId: data.dossierId,
            appUrl: APP_URL,
          },
        };
      }
      return {
        templateName: "team-client-message",
        idempotencyKey: `team-msg-${data.clientId}-${email}-${bucket}`,
        templateData: {
          clientName,
          extrait: data.extrait?.slice(0, 140),
          clientId: data.clientId,
          appUrl: APP_URL,
        },
      };
    };

    const results = await Promise.allSettled(
      emails.map((email) => sendAppEmail({ ...build(email), recipientEmail: email })),
    );
    const sent = results.filter((r) => r.status === "fulfilled" && r.value.success === true).length;
    return { ok: true as const, sent };
  });
