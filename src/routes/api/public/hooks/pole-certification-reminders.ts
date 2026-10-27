import { requireCronAuth } from "@/lib/cron-auth";
import { createFileRoute } from '@tanstack/react-router'

/**
 * Rappels du Pôle Certification & EDOF (cron horaire, cf. migration pole_certification_edof).
 *  - échéance d'étape J-3 et J ; échéance dépassée (puis tous les 2 jours)
 *  - pas de réponse après X jours (« en attente ») ; étape « en cours » trop longtemps
 *  - pièce qui expire dans 15 puis 7 jours, pièce périmée, pièce périmée avant l'envoi prévu
 *  - lien / code CDC qui expire sous 2 jours ; visio / webinaire la veille et 1 h avant
 *  - récapitulatif par mail le lundi matin
 * Anti-doublon : pc_rappels_envoyes (kind, entity_id, cle), réservé avant l'envoi.
 */

const APP_URL = 'https://izisuivis.com'
const DAY = 86_400_000

type NotifType = 'pc_echeance' | 'pc_retard' | 'pc_document' | 'pc_rappel'

function parisParts(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday as string }
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / DAY)
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10)
const frDate = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
const frDateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
function isoWeek(iso: string) {
  const d = new Date(iso + 'T12:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export const Route = createFileRoute('/api/public/hooks/pole-certification-reminders')({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: 'POST to run reminders' }),
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;
        try {
          const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
          const db = supabaseAdmin as any
          const results: Record<string, number> = { notifications: 0, emails: 0, skipped: 0, errors: 0 }
          const bump = (k: string) => { results[k] = (results[k] ?? 0) + 1 }

          const now = new Date()
          const { date: today, hour, weekday } = parisParts(now)
          const snoozed = (until: string | null) => !!until && Date.parse(until) > now.getTime()

          // ---------- Données ----------
          const { data: dossiers, error: dErr } = await db.from('pc_dossiers').select('*').is('archived_at', null)
          if (dErr) throw dErr
          const dossierIds = (dossiers ?? []).map((d: any) => d.id)
          if (dossierIds.length === 0) return Response.json({ ok: true, results })
          const dMap = new Map<string, any>((dossiers ?? []).map((d: any) => [d.id, d]))
          const [etapesR, docsR, membresR, adminsR] = await Promise.all([
            db.from('pc_etapes').select('*').in('dossier_id', dossierIds).eq('remplacee', false).neq('statut', 'valide'),
            db.from('pc_documents').select('*').in('dossier_id', dossierIds),
            db.from('pc_membres').select('dossier_id, user_id').in('dossier_id', dossierIds),
            db.from('user_roles').select('user_id').in('role', ['admin', 'direction']),
          ])
          for (const r of [etapesR, docsR, membresR, adminsR]) if (r.error) throw r.error
          const etapes: any[] = etapesR.data ?? []
          const docs: any[] = docsR.data ?? []
          const membres: any[] = membresR.data ?? []
          const admins: string[] = Array.from(new Set((adminsR.data ?? []).map((r: any) => r.user_id as string)))

          const userIds = new Set<string>(admins)
          for (const d of dossiers ?? []) userIds.add(d.responsable_id)
          for (const e of etapes) if (e.responsable_id) userIds.add(e.responsable_id)
          for (const m of membres) userIds.add(m.user_id)
          const { data: profs } = await db.from('profiles').select('id, email, prenom').in('id', Array.from(userIds))
          const pMap = new Map<string, any>((profs ?? []).map((p: any) => [p.id, p]))

          const enabledCache = new Map<string, boolean>()
          async function isEnabled(name: string) {
            if (!enabledCache.has(name)) {
              const { data } = await db.rpc('email_template_enabled', { _template_name: name })
              enabledCache.set(name, data !== false)
            }
            return enabledCache.get(name)!
          }

          async function sendEmail(templateName: string, userId: string, templateData: Record<string, any>, key: string) {
            const email = pMap.get(userId)?.email
            if (!email || !(await isEnabled(templateName))) { bump('skipped'); return }
            try {
              const { sendAppEmail } = await import('@/lib/email/send.server')
              const res = await sendAppEmail({ templateName, recipientEmail: email, idempotencyKey: key, templateData: { ...templateData, appUrl: APP_URL } })
              if (res.success) bump('emails')
              else { console.error('[pc-reminders] send failed', templateName, (res as any).reason); bump('errors') }
            } catch (e) {
              console.error('[pc-reminders] send exception', templateName, e)
              bump('errors')
            }
          }

          /** Réserve le rappel (anti-doublon) ; false s'il a déjà été envoyé. */
          async function claim(kind: string, entityId: string, cle: string) {
            const { data, error } = await db.from('pc_rappels_envoyes')
              .upsert({ kind, entity_id: entityId, cle }, { onConflict: 'kind,entity_id,cle', ignoreDuplicates: true })
              .select('kind')
            if (error) { console.error('[pc-reminders] claim failed', kind, error.message); bump('errors'); return false }
            return (data ?? []).length > 0
          }

          async function remind(r: {
            kind: string; entityId: string; cle?: string; users: (string | null | undefined)[]; type: NotifType
            titre: string; message: string; dossier: any; email: boolean
          }) {
            const cle = r.cle ?? ''
            if (!(await claim(r.kind, r.entityId, cle))) return
            const users = Array.from(new Set(r.users.filter(Boolean) as string[]))
            if (users.length === 0) return
            const { error } = await db.from('notifications').insert(users.map((u) => ({
              user_id: u, type: r.type, titre: r.titre, message: `${r.message} (${r.dossier.titre})`, link: `/pole-certification/${r.dossier.id}`,
            })))
            if (error) { console.error('[pc-reminders] notification failed', r.kind, error.message); bump('errors') }
            else results.notifications += users.length
            bump(r.kind)
            if (!r.email) return
            for (const u of users) {
              await sendEmail('pc-rappel', u, { titre: r.titre, message: r.message, dossierTitre: r.dossier.titre, dossierId: r.dossier.id }, `pc-${r.kind}-${r.entityId}-${cle}-${u}`)
            }
          }

          // ---------- Étapes ----------
          for (const e of etapes) {
            const d = dMap.get(e.dossier_id)
            if (!d || snoozed(e.rappel_reporte_jusqua)) continue
            const resp = e.responsable_id ?? d.responsable_id
            const label = `Étape ${e.ordre} — ${e.intitule}`
            const base = { entityId: e.id, dossier: d, email: e.email_actif !== false }

            if (e.date_echeance) {
              const diff = daysBetween(today, e.date_echeance)
              if (diff === 3 || diff === 0) {
                await remind({ ...base, kind: diff === 3 ? 'echeance_j3' : 'echeance_j0', users: [resp], type: 'pc_echeance',
                  titre: `${diff === 3 ? 'Échéance dans 3 jours' : "Échéance aujourd'hui"} : ${label}`, message: `Échéance le ${frDate(e.date_echeance)}.` })
              } else if (diff < 0) {
                await remind({ ...base, kind: 'retard', cle: String(Math.floor(-diff / 2)), users: [resp, d.responsable_id, ...admins], type: 'pc_retard',
                  titre: `Échéance dépassée : ${label}`, message: `En retard de ${-diff} jour(s) (échéance le ${frDate(e.date_echeance)}).` })
              }
            }

            if (e.statut === 'en_attente' && e.relance_jours && e.envoye_at
                && now.getTime() >= Date.parse(e.envoye_at) + e.relance_jours * DAY) {
              const dest = d.type === 'edof' ? 'la CDC' : (d.certificateur || 'le certificateur')
              await remind({ ...base, kind: 'relance', cle: e.envoye_at, users: [resp], type: 'pc_rappel',
                titre: `Pas de réponse de ${dest} : ${label}`,
                message: `Envoyé le ${frDate(e.envoye_at)}, sans réponse depuis ${e.relance_jours} jours. Modèle de relance disponible sur la fiche.` })
            }

            if (e.statut === 'en_cours' && e.en_cours_max_jours
                && now.getTime() >= Date.parse(e.statut_change_at) + e.en_cours_max_jours * DAY) {
              await remind({ ...base, kind: 'en_cours_long', cle: e.statut_change_at, users: [resp], type: 'pc_rappel',
                titre: `Étape en cours depuis plus de ${e.en_cours_max_jours} jours : ${label}`, message: 'Pensez à la faire avancer ou à mettre à jour son statut.' })
            }

            if (e.lien_expire_at) {
              const left = Date.parse(e.lien_expire_at) - now.getTime()
              if (left > 0 && left <= 2 * DAY) {
                await remind({ ...base, kind: 'lien_expire', cle: e.lien_expire_at, users: [resp], type: 'pc_rappel',
                  titre: 'Le lien / code de la CDC expire bientôt', message: `Expiration le ${frDateTime(e.lien_expire_at)}.` })
              }
            }

            if (e.event_at) {
              const left = Date.parse(e.event_at) - now.getTime()
              const quoi = e.event_kind === 'webinaire' ? 'Webinaire' : 'Visio'
              const participants = [resp, d.responsable_id, ...membres.filter((m) => m.dossier_id === d.id).map((m) => m.user_id)]
              const veille = left >= 23 * 3_600_000 && left <= 25 * 3_600_000
              const uneHeure = left >= 30 * 60_000 && left <= 90 * 60_000
              if (veille || uneHeure) {
                await remind({ ...base, kind: veille ? 'event_veille' : 'event_1h', cle: e.event_at, users: participants, type: 'pc_rappel',
                  titre: `${quoi} ${veille ? 'demain' : 'dans 1 heure'} : ${label}`, message: `Le ${frDateTime(e.event_at)}.` })
              }
            }
          }

          // ---------- Pièces ----------
          for (const doc of docs) {
            const d = dMap.get(doc.dossier_id)
            if (!d || !doc.date_peremption || snoozed(doc.rappel_reporte_jusqua)) continue
            const j = daysBetween(today, doc.date_peremption)
            const base = { entityId: doc.id, cle: doc.date_peremption, users: [d.responsable_id], type: 'pc_document' as const, dossier: d, email: true }
            if (j < 0) {
              await remind({ ...base, kind: 'doc_perime', titre: `Pièce périmée : ${doc.nom}`, message: `Périmée depuis le ${frDate(doc.date_peremption)}. Déposez une nouvelle version.` })
            } else if (j <= 7) {
              await remind({ ...base, kind: 'doc_j7', titre: `Pièce qui expire dans ${j} jour(s) : ${doc.nom}`, message: `Péremption le ${frDate(doc.date_peremption)}.` })
            } else if (j <= 15) {
              await remind({ ...base, kind: 'doc_j15', titre: `Pièce qui expire dans ${j} jours : ${doc.nom}`, message: `Péremption le ${frDate(doc.date_peremption)}.` })
            }
            // Collecte EDOF : la pièce sera-t-elle périmée à la date d'envoi prévue ?
            if (j >= 0) {
              const envoi = etapes.find((e) => e.dossier_id === d.id && e.bloque_si_piece_perimee && e.date_echeance)
              if (envoi && doc.date_peremption < envoi.date_echeance) {
                await remind({ ...base, kind: 'doc_avant_envoi', cle: envoi.date_echeance,
                  titre: `Pièce périmée avant l'envoi prévu : ${doc.nom}`,
                  message: `Péremption le ${frDate(doc.date_peremption)}, envoi prévu le ${frDate(envoi.date_echeance)} : prévoir une version plus récente.` })
              }
            }
          }

          // ---------- Récapitulatif du lundi ----------
          if (weekday === 'Mon' && (hour === 7 || hour === 8)) {
            const finSemaine = addDays(today, 6)
            const week = isoWeek(today)
            const recipients = new Set<string>([...admins, ...(dossiers ?? []).map((d: any) => d.responsable_id as string)])
            for (const u of recipients) {
              const isAdmin = admins.includes(u)
              const mine = (dossierId: string, etapeResp?: string | null) => isAdmin || dMap.get(dossierId)?.responsable_id === u || etapeResp === u
              const echeances = etapes
                .filter((e) => e.date_echeance && e.date_echeance >= today && e.date_echeance <= finSemaine && mine(e.dossier_id, e.responsable_id))
                .map((e) => ({ titre: dMap.get(e.dossier_id).titre, detail: `Étape ${e.ordre} — ${e.intitule} le ${frDate(e.date_echeance)}`, dossierId: e.dossier_id }))
              const documents = docs
                .filter((x) => x.date_peremption && daysBetween(today, x.date_peremption) <= 15 && mine(x.dossier_id))
                .map((x) => ({ titre: dMap.get(x.dossier_id).titre, detail: `${x.nom} : ${x.date_peremption < today ? 'périmée depuis' : 'expire le'} ${frDate(x.date_peremption)}`, dossierId: x.dossier_id }))
              const retards = etapes
                .filter((e) => e.date_echeance && e.date_echeance < today && mine(e.dossier_id, e.responsable_id))
                .map((e) => ({ titre: dMap.get(e.dossier_id).titre, detail: `Étape ${e.ordre} — ${e.intitule} (échéance ${frDate(e.date_echeance)})`, dossierId: e.dossier_id }))
              if (echeances.length + documents.length + retards.length === 0) continue
              if (!(await claim('recap_hebdo', u, week))) continue
              await sendEmail('pc-recap-hebdo', u, { prenom: pMap.get(u)?.prenom, echeances, documents, retards }, `pc-recap-${week}-${u}`)
              bump('recap_hebdo')
            }
          }

          return Response.json({ ok: true, results })
        } catch (err: any) {
          console.error('[pc-reminders] fatal', err)
          return Response.json({ ok: false, error: err?.message ?? 'unknown' }, { status: 500 })
        }
      },
    },
  },
})
