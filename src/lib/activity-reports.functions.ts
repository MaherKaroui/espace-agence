import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const rangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  userId: z.string().uuid().optional(),
});

/** Rapports d'activité par personne (tâches) sur une période. */
export const getActivityReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { from: string; to: string; userId?: string }) => rangeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;

    const { data: callerRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const roles = (callerRoles ?? []).map((r: any) => r.role as string);
    const isAdmin = roles.includes("admin") || roles.includes("direction");

    // Un collaborateur ne voit que son propre rapport.
    const restrictTo = isAdmin ? (data.userId ?? null) : callerId;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const from = new Date(data.from).toISOString();
    const to = new Date(data.to).toISOString();
    const now = new Date();

    // Membres de l'équipe (tous sauf les comptes purement clients)
    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const rolesByUser = new Map<string, string[]>();
    for (const r of roleRows ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }
    let memberIds = [...rolesByUser.entries()]
      .filter(([, rs]) => rs.some((r) => r !== "client"))
      .map(([id]) => id);
    if (restrictTo) memberIds = memberIds.filter((id) => id === restrictTo);
    if (memberIds.length === 0) return { members: [] as any[], isAdmin };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, prenom, nom, email, avatar_url, archived_at")
      .in("id", memberIds);

    // Toutes les tâches non archivées
    const { data: tasks } = await supabaseAdmin
      .from("agency_tasks")
      .select(
        "id, title, description, priority, status, due_date, completed_at, created_at, updated_at, client_id, dossier_id, pole_id, internal_comment, assigned_to",
      )
      .is("archived_at", null)
      .limit(3000);

    const taskList = tasks ?? [];
    const { data: extraAssignees } = taskList.length
      ? await supabaseAdmin
          .from("agency_task_assignees")
          .select("task_id, user_id")
          .in(
            "task_id",
            taskList.map((t: any) => t.id),
          )
      : ({ data: [] } as any);

    const byUser = new Map<string, any[]>();
    const push = (uid: string | null, t: any) => {
      if (!uid || !memberIds.includes(uid)) return;
      const arr = byUser.get(uid) ?? [];
      if (!arr.some((x) => x.id === t.id)) arr.push(t);
      byUser.set(uid, arr);
    };
    const taskById = new Map<string, any>(taskList.map((t: any) => [t.id, t]));
    for (const t of taskList) push(t.assigned_to, t);
    for (const a of extraAssignees ?? []) {
      const t = taskById.get(a.task_id);
      if (t) push(a.user_id, t);
    }

    // Enrichissement clients / dossiers / pôles
    const clientIds = new Set<string>();
    const dossierIds = new Set<string>();
    const poleIds = new Set<string>();
    for (const t of taskList) {
      if (t.client_id) clientIds.add(t.client_id);
      if (t.dossier_id) dossierIds.add(t.dossier_id);
      if (t.pole_id) poleIds.add(t.pole_id);
    }
    const [{ data: clients }, { data: dossiers }, { data: poles }] = await Promise.all([
      clientIds.size
        ? supabaseAdmin.from("profiles").select("id, prenom, nom, entreprise").in("id", [...clientIds])
        : Promise.resolve({ data: [] } as any),
      dossierIds.size
        ? supabaseAdmin.from("dossiers").select("id, titre, organisme_nom").in("id", [...dossierIds])
        : Promise.resolve({ data: [] } as any),
      poleIds.size
        ? supabaseAdmin.from("poles").select("id, nom, couleur").in("id", [...poleIds])
        : Promise.resolve({ data: [] } as any),
    ]);
    const cMap = new Map<string, any>((clients ?? []).map((c: any) => [c.id, c]));
    const dMap = new Map<string, any>((dossiers ?? []).map((d: any) => [d.id, d]));
    const pMap = new Map<string, any>((poles ?? []).map((p: any) => [p.id, p]));

    const label = (t: any) => {
      const d = t.dossier_id ? dMap.get(t.dossier_id) : null;
      if (d) return d.titre || d.organisme_nom || "Dossier";
      const c = t.client_id ? cMap.get(t.client_id) : null;
      if (c) return c.entreprise || `${c.prenom ?? ""} ${c.nom ?? ""}`.trim();
      const p = t.pole_id ? pMap.get(t.pole_id) : null;
      return p?.nom ?? null;
    };

    const shape = (t: any) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      due_date: t.due_date,
      completed_at: t.completed_at,
      created_at: t.created_at,
      note: t.internal_comment ?? t.description ?? null,
      context: label(t),
      pole: t.pole_id ? (pMap.get(t.pole_id)?.nom ?? null) : null,
      daysSinceStart: Math.max(
        0,
        Math.round((now.getTime() - new Date(t.created_at).getTime()) / 86400000),
      ),
    });

    const inPeriod = (iso: string | null) => !!iso && iso >= from && iso <= to;
    const soon = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();

    const members = (profiles ?? []).map((p: any) => {
      const list = byUser.get(p.id) ?? [];
      const done = list.filter((t) => t.status === "terminee" && inPeriod(t.completed_at)).map(shape);
      const open = list.filter((t) => t.status !== "terminee");
      const inProgress = open
        .filter((t) => ["en_cours", "en_attente", "bloquee"].includes(t.status))
        .map(shape);
      const upcoming = open
        .filter((t) => t.status === "a_faire")
        .map(shape)
        .sort((a, b) => (a.due_date ?? "9999") > (b.due_date ?? "9999") ? 1 : -1);
      const overdue = open
        .filter((t) => t.due_date && t.due_date < now.toISOString())
        .map(shape);
      const blocked = open.filter((t) => t.status === "bloquee").map(shape);
      const dueSoon = open
        .filter((t) => t.due_date && t.due_date >= now.toISOString() && t.due_date <= soon)
        .map(shape);

      const contexts = Array.from(
        new Set(
          [...done, ...inProgress]
            .map((t) => t.context)
            .filter(Boolean) as string[],
        ),
      );

      const total = done.length + open.length;
      return {
        id: p.id,
        prenom: p.prenom,
        nom: p.nom,
        email: p.email,
        avatar_url: p.avatar_url,
        archived: !!p.archived_at,
        roles: rolesByUser.get(p.id) ?? [],
        counts: {
          done: done.length,
          inProgress: inProgress.length,
          upcoming: upcoming.length,
          overdue: overdue.length,
          completionRate: total > 0 ? Math.round((done.length / total) * 100) : 0,
        },
        done,
        inProgress,
        upcoming,
        overdue,
        blocked,
        dueSoon,
        contexts,
      };
    });

    members.sort((a, b) => `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`));
    return { members, isAdmin };
  });
