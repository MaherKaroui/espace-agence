import { notifyEmail } from './notify'
import { getTeamRecipientsForDossier, getTeamRecipientsForClient } from '@/lib/team-notify.functions'

const CATEGORIE_LABELS: Record<string, string> = {
  qualiopi: 'Qualiopi', ndc: 'NDA', rncp: 'RNCP', cpf: 'CPF', datadock: 'Datadock', autre: 'Autre',
}
const STATUT_LABELS: Record<string, string> = {
  nouveau: 'Nouveau', en_attente: 'En attente', documents_manquants: 'Documents manquants',
  en_cours_etude: "En cours d'étude", en_cours_traitement: 'En cours de traitement',
  a_completer: 'À compléter', valide: 'Validé', refuse: 'Refusé', termine: 'Terminé', annule: 'Annulé',
}

/** Notifier l'équipe (pôle + admins + direction) d'un nouveau dossier. Fire-and-forget. */
export async function notifyTeamNewDossier(dossierId: string) {
  try {
    const info = await getTeamRecipientsForDossier({ data: { dossierId } })
    if (!info?.emails?.length) return
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000))
    await Promise.allSettled(info.emails.map((email) =>
      notifyEmail({
        templateName: 'team-nouveau-dossier',
        recipientEmail: email,
        idempotencyKey: `team-new-dossier-${dossierId}-${email}-${bucket}`,
        templateData: {
          clientName: info.clientName ?? undefined,
          clientEmail: info.clientEmail ?? undefined,
          dossierTitre: info.dossierTitre ?? undefined,
          categorie: info.categorie ? (CATEGORIE_LABELS[info.categorie] ?? info.categorie) : undefined,
          poleName: info.poleName ?? undefined,
          statut: info.statut ? (STATUT_LABELS[info.statut] ?? info.statut) : undefined,
          dossierId,
        },
      })
    ))
  } catch { /* silencieux */ }
}

/** Notifier l'équipe qu'un client vient de déposer un document. */
export async function notifyTeamDocumentDepose(dossierId: string, documentNom?: string) {
  try {
    const info = await getTeamRecipientsForDossier({ data: { dossierId } })
    if (!info?.emails?.length) return
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000))
    await Promise.allSettled(info.emails.map((email) =>
      notifyEmail({
        templateName: 'team-document-depose',
        recipientEmail: email,
        idempotencyKey: `team-doc-${dossierId}-${email}-${bucket}`,
        templateData: {
          clientName: info.clientName ?? undefined,
          dossierTitre: info.dossierTitre ?? undefined,
          documentNom,
          poleName: info.poleName ?? undefined,
          dossierId,
        },
      })
    ))
  } catch { /* silencieux */ }
}

/** Notifier l'équipe qu'un client vient d'envoyer un message. */
export async function notifyTeamClientMessage(clientId: string, extrait?: string) {
  try {
    const info = await getTeamRecipientsForClient({ data: { clientId } })
    if (!info?.emails?.length) return
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000))
    await Promise.allSettled(info.emails.map((email) =>
      notifyEmail({
        templateName: 'team-client-message',
        recipientEmail: email,
        idempotencyKey: `team-msg-${clientId}-${email}-${bucket}`,
        templateData: {
          clientName: info.clientName ?? undefined,
          extrait: extrait?.slice(0, 140),
          clientId,
        },
      })
    ))
  } catch { /* silencieux */ }
}
