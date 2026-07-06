// Format inline: @[Nom](user:uuid) et #[Libellé](type:uuid)
// type ∈ client | dossier | task | pole
export type MentionEntityType = "client" | "dossier" | "task" | "pole";

export type MentionUser = { id: string; label: string };
export type MentionEntity = { type: MentionEntityType; id: string; label: string };

const USER_RE = /@\[([^\]]+)\]\(user:([0-9a-f-]{36})\)/gi;
const ENT_RE = /#\[([^\]]+)\]\((client|dossier|task|pole):([0-9a-f-]{36})\)/gi;

export function extractMentions(content: string): {
  users: MentionUser[];
  entities: MentionEntity[];
} {
  const users: MentionUser[] = [];
  const entities: MentionEntity[] = [];
  const seenU = new Set<string>();
  const seenE = new Set<string>();
  content.replace(USER_RE, (_, label, id) => {
    if (!seenU.has(id)) {
      seenU.add(id);
      users.push({ id, label });
    }
    return "";
  });
  content.replace(ENT_RE, (_, label, type, id) => {
    const k = `${type}:${id}`;
    if (!seenE.has(k)) {
      seenE.add(k);
      entities.push({ type: type as MentionEntityType, id, label });
    }
    return "";
  });
  return { users, entities };
}

export type MentionSegment =
  | { kind: "text"; value: string }
  | { kind: "user"; id: string; label: string }
  | { kind: "entity"; type: MentionEntityType; id: string; label: string };

export function parseMentionSegments(content: string): MentionSegment[] {
  const segs: MentionSegment[] = [];
  const combined = new RegExp(
    `(@\\[[^\\]]+\\]\\(user:[0-9a-f-]{36}\\))|(#\\[[^\\]]+\\]\\((?:client|dossier|task|pole):[0-9a-f-]{36}\\))`,
    "gi",
  );
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(content)) !== null) {
    if (m.index > last) segs.push({ kind: "text", value: content.slice(last, m.index) });
    const token = m[0];
    const uMatch = /^@\[([^\]]+)\]\(user:([0-9a-f-]{36})\)$/i.exec(token);
    if (uMatch) {
      segs.push({ kind: "user", id: uMatch[2], label: uMatch[1] });
    } else {
      const eMatch = /^#\[([^\]]+)\]\((client|dossier|task|pole):([0-9a-f-]{36})\)$/i.exec(token);
      if (eMatch) {
        segs.push({
          kind: "entity",
          type: eMatch[1] as MentionEntityType,
          id: eMatch[3],
          label: eMatch[2],
        });
      }
    }
    last = m.index + token.length;
  }
  if (last < content.length) segs.push({ kind: "text", value: content.slice(last) });
  return segs;
}

export function entityLink(type: MentionEntityType, id: string): string {
  switch (type) {
    case "client":
      return `/admin/clients/${id}`;
    case "dossier":
      return `/admin/dossiers/${id}`;
    case "task":
      return `/admin/taches-agence?task=${id}`;
    case "pole":
      return `/admin/poles?pole=${id}`;
  }
}
