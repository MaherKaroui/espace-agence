import { notifyTeamFn } from '@/lib/team-notify.functions'

/** Notifier l'équipe (pôle + admins + direction) d'un nouveau dossier. Fire-and-forget. */
export async function notifyTeamNewDossier(dossierId: string) {
  try {
    await notifyTeamFn({ data: { event: 'nouveau_dossier', dossierId } })
  } catch (e) { console.warn('[notify-team]', e) }
}

/** Notifier l'équipe qu'un client vient de déposer un document. */
export async function notifyTeamDocumentDepose(dossierId: string, documentNom?: string) {
  try {
    await notifyTeamFn({ data: { event: 'document_depose', dossierId, documentNom } })
  } catch (e) { console.warn('[notify-team]', e) }
}

/** Notifier l'équipe qu'un client vient d'envoyer un message. */
export async function notifyTeamClientMessage(clientId: string, extrait?: string) {
  try {
    await notifyTeamFn({ data: { event: 'client_message', clientId, extrait } })
  } catch (e) { console.warn('[notify-team]', e) }
}
