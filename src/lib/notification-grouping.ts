// Regroupe les notifications par (type, link, jour) afin de collapser
// les doublons visuels (mêmes messages, mêmes RDV, etc.). Les groupes
// non lus restent flagged unread tant qu'au moins une notif est non lue.

import { statutLabel, STATUTS } from "@/lib/labels";

export type NotifRow = {
  id: string;
  type: string;
  titre: string;
  message: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotifGroup = {
  key: string;
  ids: string[];
  unreadIds: string[];
  type: string;
  link: string | null;
  titre: string;
  message: string | null;
  count: number;
  latest_at: string;
  unread: boolean;
};

// Titre sans compteur — le badge à côté affiche déjà le nombre.
const GROUP_TITLES: Record<string, (n: number) => string> = {
  message: (n) => (n > 1 ? "Nouveaux messages" : "Nouveau message"),
  document_depose: (n) => (n > 1 ? "Documents déposés" : "Document déposé"),
  document_demande: (n) => (n > 1 ? "Documents demandés" : "Document demandé"),
  tache_attente: (n) => (n > 1 ? "Tâches en attente" : "Tâche en attente"),
  tache_assignee: (n) => "Tâches assignées",
  rdv: (n) => "Rendez-vous",
  statut_change: (n) => (n > 1 ? "Changements de statut" : "Changement de statut"),
  alerte: (n) => (n > 1 ? "Alertes sécurité" : "Alerte sécurité"),
  rapport_quotidien: (n) => (n > 1 ? "Rapports quotidiens" : "Rapport quotidien"),
};

// Remplace les enums techniques (en_attente, documents_manquants…) par leur libellé FR.
const STATUT_REGEX = new RegExp(
  `\\b(${STATUTS.map((s) => s.value).join("|")})\\b`,
  "g",
);
function humanize(text: string | null): string | null {
  if (!text) return text;
  return text.replace(STATUT_REGEX, (m) => statutLabel(m));
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export function groupNotifications(rows: NotifRow[]): NotifGroup[] {
  const buckets: Record<string, NotifRow[]> = {};
  for (const n of rows) {
    const k = `${n.type}|${n.link ?? ""}|${dayKey(n.created_at)}`;
    (buckets[k] ||= []).push(n);
  }

  const groups: NotifGroup[] = Object.entries(buckets).map(([k, arr]) => {
    // Latest first (rows already desc, but be defensive)
    arr.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const latest = arr[0];
    const count = arr.length;
    const unreadIds = arr.filter((r) => !r.read_at).map((r) => r.id);
    const anyUnread = unreadIds.length > 0;
    const titre =
      count > 1 && GROUP_TITLES[latest.type]
        ? GROUP_TITLES[latest.type](count)
        : humanize(latest.titre) ?? latest.titre;
    return {
      key: k,
      ids: arr.map((r) => r.id),
      unreadIds,
      type: latest.type,
      link: latest.link,
      titre,
      message: humanize(latest.message),
      count,
      latest_at: latest.created_at,
      unread: anyUnread,
    };
  });

  return groups.sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));
}
