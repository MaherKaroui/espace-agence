import { supabase } from '@/integrations/supabase/client'
import { sendTransactionalEmail, type SendEmailArgs } from './send'
import { APP_URL } from '@/lib/app-url'

/**
 * Human labels for dossier statuts + short explanations for the client email.
 */
export const STATUT_LABELS: Record<string, { label: string; explication: string }> = {
  en_attente: { label: 'En attente', explication: "Votre dossier est en file d'attente. Nous le prenons en charge très bientôt." },
  documents_manquants: { label: 'Documents manquants', explication: "Il manque encore des documents pour traiter votre dossier. Consultez la liste dans votre espace." },
  en_cours_etude: { label: "En cours d'étude", explication: "Notre équipe étudie actuellement votre dossier." },
  en_cours_traitement: { label: 'En cours de traitement', explication: "Votre dossier est en cours de traitement. Nous vous tiendrons informé·e des prochaines étapes." },
  a_completer: { label: 'À compléter', explication: "Une action de votre part est attendue. Merci de consulter votre dossier." },
  valide: { label: 'Validé', explication: "Votre dossier a été validé. Nous poursuivons les démarches associées." },
  refuse: { label: 'Refusé', explication: "Votre dossier n'a pas pu aboutir. Un conseiller reviendra vers vous rapidement." },
  termine: { label: 'Terminé', explication: "Votre dossier est finalisé. Merci pour votre confiance !" },
  annule: { label: 'Annulé', explication: "Votre dossier a été annulé." },
}

/** True if the given template is enabled in email_settings. Falls back to true on error. */
export async function isTemplateEnabled(templateName: string): Promise<boolean> {
  try {
    const { data } = await supabase.rpc('email_template_enabled', { _template_name: templateName })
    return data !== false
  } catch {
    return true
  }
}

/**
 * Send a transactional email only if the template is enabled by the admin.
 * Wraps sendTransactionalEmail, adds an automatic app URL, and never throws.
 */
export async function notifyEmail(args: SendEmailArgs & { templateData?: Record<string, any> }): Promise<boolean> {
  const enabled = await isTemplateEnabled(args.templateName)
  if (!enabled) return false
  return sendTransactionalEmail({
    ...args,
    templateData: { ...(args.templateData || {}), appUrl: APP_URL },
  })
}
