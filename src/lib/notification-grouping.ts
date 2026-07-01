// Regroupe les notifications non lues par (type, link) pour éviter le bruit.
// Les notifications lues restent individuelles (historique).

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
  type: string;
  link: string | null;
  titre: string;
  message: string | null;
  count: number;
  latest_at: string;
  unread: boolean;
};

const GROUP_TITLES: Record<string, (n: number) => string> = {
  message: (n) => `${n} nouveaux messages`,
  document_depose: (n) => `${n} documents déposés`,
  document_demande: (n) => `${n} documents demandés`,
  tache_attente: (n) => `${n} tâches en attente`,
  tache_assignee: (n) => `${n} tâches assignées`,
  rdv: (n) => `${n} rendez-vous`,
  statut_change: (n) => `${n} changements de statut`,
  alerte: (n) => `${n} alertes sécurité`,
  rapport_quotidien: (n) => `${n} rapports quotidiens`,
};

export function groupNotifications(rows: NotifRow[]): NotifGroup[] {
  const unread: Record<string, NotifRow[]> = {};
  const out: NotifGroup[] = [];

  for (const n of rows) {
    if (n.read_at) {
      out.push({
        key: n.id,
        ids: [n.id],
        type: n.type,
        link: n.link,
        titre: n.titre,
        message: n.message,
        count: 1,
        latest_at: n.created_at,
        unread: false,
      });
    } else {
      const k = `${n.type}|${n.link ?? ""}`;
      (unread[k] ||= []).push(n);
    }
  }

  const groups: NotifGroup[] = Object.entries(unread).map(([k, arr]) => {
    const latest = arr[0]; // rows are ordered desc by created_at
    const count = arr.length;
    const titre =
      count > 1 && GROUP_TITLES[latest.type]
        ? GROUP_TITLES[latest.type](count)
        : latest.titre;
    return {
      key: k,
      ids: arr.map((r) => r.id),
      type: latest.type,
      link: latest.link,
      titre,
      message: count > 1 ? latest.message : latest.message,
      count,
      latest_at: latest.created_at,
      unread: true,
    };
  });

  return [...groups, ...out].sort((a, b) =>
    a.latest_at < b.latest_at ? 1 : -1,
  );
}
