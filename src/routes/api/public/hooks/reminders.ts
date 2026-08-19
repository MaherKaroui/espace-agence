import { requireCronAuth } from "@/lib/cron-auth";
import { createFileRoute } from '@tanstack/react-router'

/**
 * Automatic reminder cron.
 * Sends emails for:
 *  - documents missing (from_agence=true, no file) at 24h / 72h / 7 days
 *  - dossiers with no activity for 7 days
 *  - upcoming rendez_vous in ~24h and ~1h
 * Duplicate protection via public.notification_reminders_sent (kind, entity_id).
 */

type Kind =
  | 'doc_missing_24h' | 'doc_missing_72h' | 'doc_missing_7d'
  | 'dossier_inactive_7d'
  | 'rdv_24h' | 'rdv_1h'

interface Sent {
  kind: Kind
  entity_id: string
}

const APP_URL = 'https://izisuivis.com'

function frDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

export const Route = createFileRoute('/api/public/hooks/reminders')({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, hint: 'POST to run reminders' }),
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;
        try {
          const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

          const results: Record<string, number> = {
            doc_missing_24h: 0, doc_missing_72h: 0, doc_missing_7d: 0,
            dossier_inactive_7d: 0, rdv_24h: 0, rdv_1h: 0,
            skipped: 0, errors: 0,
          }

          // Helper: check template enabled
          const enabledCache = new Map<string, boolean>()
          async function isEnabled(name: string): Promise<boolean> {
            if (enabledCache.has(name)) return enabledCache.get(name)!
            const { data } = await supabaseAdmin.rpc('email_template_enabled' as any, { _template_name: name })
            const v = data !== false
            enabledCache.set(name, v)
            return v
          }

          // Helper: send via internal endpoint using service-role bearer
          async function sendEmail(templateName: string, recipientEmail: string, templateData: Record<string, any>, idempotencyKey: string) {
            if (!(await isEnabled(templateName))) { results.skipped++; return false }
            const origin = process.env.SUPABASE_URL ? APP_URL : APP_URL
            const url = `${origin}/lovable/email/transactional/send`
            const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
            try {
              const res = await fetch(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${key}`,
                },
                body: JSON.stringify({
                  templateName,
                  recipientEmail,
                  idempotencyKey,
                  templateData: { ...templateData, appUrl: APP_URL },
                }),
              })
              if (!res.ok) {
                console.error('[reminders] send failed', templateName, res.status, await res.text())
                results.errors++
                return false
              }
              return true
            } catch (e) {
              console.error('[reminders] send exception', templateName, e)
              results.errors++
              return false
            }
          }

          async function markSent(kind: Kind, entityId: string) {
            await supabaseAdmin.from('notification_reminders_sent').insert({ kind, entity_id: entityId })
          }

          async function alreadySent(kind: Kind, entityIds: string[]): Promise<Set<string>> {
            if (entityIds.length === 0) return new Set()
            const { data } = await supabaseAdmin
              .from('notification_reminders_sent')
              .select('entity_id')
              .eq('kind', kind)
              .in('entity_id', entityIds)
            return new Set((data ?? []).map((r: any) => r.entity_id))
          }

          // ============= DOCUMENTS MANQUANTS =============
          const now = new Date()
          const hAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString()

          // Pull all pending demands (from_agence, no file, en_attente) up to ~30 days old
          const { data: pendingDocs } = await supabaseAdmin
            .from('documents')
            .select('id, nom, dossier_id, created_at, dossiers!inner(id, titre, client_id, statut)')
            .eq('from_agence', true)
            .is('storage_path', null)
            .lt('created_at', hAgo(24))
            .gt('created_at', hAgo(24 * 30))

          if (pendingDocs && pendingDocs.length > 0) {
            // Get client emails
            const clientIds = Array.from(new Set(pendingDocs.map((d: any) => d.dossiers.client_id)))
            const { data: profiles } = await supabaseAdmin
              .from('profiles')
              .select('id, email, prenom')
              .in('id', clientIds)
            const profMap = new Map((profiles ?? []).map((p: any) => [p.id, p]))

            const buckets: { kind: Kind; label: string; minH: number; maxH: number }[] = [
              { kind: 'doc_missing_7d', label: '7 jours', minH: 24 * 7, maxH: 24 * 30 },
              { kind: 'doc_missing_72h', label: '3 jours', minH: 72, maxH: 24 * 7 },
              { kind: 'doc_missing_24h', label: '24 heures', minH: 24, maxH: 72 },
            ]

            for (const b of buckets) {
              const inBucket = pendingDocs.filter((d: any) => {
                const ageH = (now.getTime() - new Date(d.created_at).getTime()) / 3600000
                return ageH >= b.minH && ageH < b.maxH
              })
              if (inBucket.length === 0) continue
              const keys = inBucket.map((d: any) => `${d.id}`)
              const done = await alreadySent(b.kind, keys)
              for (const d of inBucket as any[]) {
                if (done.has(d.id)) continue
                const prof = profMap.get(d.dossiers.client_id) as any
                if (!prof?.email) continue
                const ok = await sendEmail(
                  'client-document-rappel',
                  prof.email,
                  {
                    prenom: prof.prenom,
                    docNom: d.nom,
                    dossierTitre: d.dossiers.titre,
                    dossierId: d.dossier_id,
                    delayLabel: b.label,
                  },
                  `reminder-${b.kind}-${d.id}`,
                )
                if (ok) { await markSent(b.kind, d.id); results[b.kind]++ }
              }
            }
          }

          // ============= DOSSIERS INACTIFS 7J =============
          const { data: inactive } = await supabaseAdmin
            .from('dossiers')
            .select('id, titre, client_id, updated_at, statut')
            .not('statut', 'in', '(termine,annule,refuse)')
            .lt('updated_at', hAgo(24 * 7))
            .gt('updated_at', hAgo(24 * 60)) // avoid spamming very old dossiers indefinitely
            .limit(500)
          if (inactive && inactive.length > 0) {
            const ids = inactive.map((d: any) => d.id)
            const done = await alreadySent('dossier_inactive_7d', ids)
            const cids = Array.from(new Set(inactive.map((d: any) => d.client_id)))
            const { data: profs } = await supabaseAdmin.from('profiles').select('id, email, prenom').in('id', cids)
            const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]))
            for (const d of inactive as any[]) {
              if (done.has(d.id)) continue
              const p = pmap.get(d.client_id) as any
              if (!p?.email) continue
              const ok = await sendEmail(
                'client-dossier-inactif',
                p.email,
                { prenom: p.prenom, dossierTitre: d.titre, dossierId: d.id },
                `reminder-dossier-inactive-7d-${d.id}`,
              )
              if (ok) { await markSent('dossier_inactive_7d', d.id); results.dossier_inactive_7d++ }
            }
          }

          // ============= RENDEZ-VOUS À VENIR =============
          const in25h = new Date(now.getTime() + 25 * 3600 * 1000).toISOString()
          const in23h = new Date(now.getTime() + 23 * 3600 * 1000).toISOString()
          const in90m = new Date(now.getTime() + 90 * 60 * 1000).toISOString()
          const in30m = new Date(now.getTime() + 30 * 60 * 1000).toISOString()

          const windows: { kind: Kind; from: string; to: string; label: string }[] = [
            { kind: 'rdv_24h', from: in23h, to: in25h, label: 'demain' },
            { kind: 'rdv_1h', from: in30m, to: in90m, label: 'dans 1 heure' },
          ]

          for (const w of windows) {
            const { data: rdvs } = await supabaseAdmin
              .from('rendez_vous')
              .select('id, client_id, starts_at, status')
              .eq('status', 'confirme')
              .gte('starts_at', w.from)
              .lte('starts_at', w.to)
            if (!rdvs || rdvs.length === 0) continue
            const ids = rdvs.map((r: any) => r.id)
            // Reuse rdv_reminders_sent for RDV kinds (existing table)
            const { data: existing } = await supabaseAdmin
              .from('rdv_reminders_sent')
              .select('rdv_id')
              .eq('kind', w.kind)
              .in('rdv_id', ids)
            const done = new Set((existing ?? []).map((r: any) => r.rdv_id))
            const cids = Array.from(new Set(rdvs.map((r: any) => r.client_id)))
            const { data: profs } = await supabaseAdmin.from('profiles').select('id, email, prenom').in('id', cids)
            const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]))
            for (const r of rdvs as any[]) {
              if (done.has(r.id)) continue
              const p = pmap.get(r.client_id) as any
              if (!p?.email) continue
              const ok = await sendEmail(
                'client-rdv-rappel',
                p.email,
                { prenom: p.prenom, dateLabel: frDate(r.starts_at), delayLabel: w.label },
                `reminder-${w.kind}-${r.id}`,
              )
              if (ok) {
                await supabaseAdmin.from('rdv_reminders_sent').insert({ rdv_id: r.id, kind: w.kind })
                results[w.kind]++
              }
            }
          }


          return Response.json({ ok: true, results })

        } catch (err: any) {
          console.error('[reminders] fatal', err)
          return Response.json({ ok: false, error: err?.message ?? 'unknown' }, { status: 500 })
        }
      },
    },
  },
})
