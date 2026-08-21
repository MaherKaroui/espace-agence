import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import { styles as s } from './_shared'

interface Props {
  dateFr?: string
  periode?: string
  synthese?: Record<string, any>
  classement?: { nom: string; done: number }[]
  personnes?: any[]
  appUrl?: string
  pdfUrl?: string | null
}

const box = {
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '14px',
  marginTop: '14px',
  background: '#ffffff',
}

const nameStyle = {
  fontSize: '17px',
  color: '#0f172a',
  margin: '0 0 2px',
  fontWeight: 700 as const,
}

const meta = { fontSize: '12px', color: '#64748b', margin: '0 0 8px' }
const blockTitle = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  color: '#475569',
  letterSpacing: '0.5px',
  margin: '10px 0 2px',
  fontWeight: 700 as const,
}
const line = { fontSize: '13px', color: '#334155', lineHeight: '19px', margin: '2px 0' }
const muted = { fontSize: '13px', color: '#94a3b8', margin: '2px 0' }

const SYNTH: [string, string][] = [
  ['tachesTerminees', 'Tâches terminées'],
  ['tachesEnCours', 'Tâches en cours'],
  ['tachesEnRetard', 'Tâches en retard'],
  ['dossiersCrees', 'Dossiers créés'],
  ['changementsStatut', 'Changements de statut'],
  ['documentsDeposes', 'Documents déposés'],
  ['messages', 'Messages échangés'],
  ['nouveauxClients', 'Nouveaux clients'],
]

function Personne({ p }: { p: any }) {
  const pr = p.presence ?? {}
  const t = p.taches ?? {}
  return (
    <Section style={box}>
      <Text style={nameStyle}>{p.nom}</Text>
      <Text style={meta}>
        {(p.roles ?? []).join(' · ') || 'Rôle non défini'}
        {(p.poles ?? []).length ? ` — Pôle ${(p.poles ?? []).join(', ')}` : ''}
      </Text>

      <Text style={blockTitle}>Présence</Text>
      <Text style={line}>
        {pr.dureeLabel ?? '0 min'} de connexion · {pr.sessions ?? 0} session(s)
        {pr.premiere ? ` · de ${pr.premiere} à ${pr.derniere}` : ''}
      </Text>
      {((pr.lieux ?? []).length > 0 || (pr.appareils ?? []).length > 0) && (
        <Text style={muted}>
          {[...(pr.lieux ?? []), ...(pr.appareils ?? [])].join(' · ')}
        </Text>
      )}

      {!p.hasActivity && (
        <Text style={{ ...s.warning, margin: '10px 0 0' }}>Aucune activité enregistrée sur la période.</Text>
      )}

      {(t.done ?? []).length > 0 && (
        <>
          <Text style={blockTitle}>Tâches terminées ({(t.done ?? []).length})</Text>
          {(t.done ?? []).map((x: any, i: number) => (
            <Text key={i} style={line}>
              • {x.titre}
              {x.contexte ? ` — ${x.contexte}` : ''} {x.heure ? `(${x.heure})` : ''}
              {x.priorite ? ` · ${x.priorite}` : ''}
              {x.note ? ` — ${x.note}` : ''}
            </Text>
          ))}
        </>
      )}

      {(t.inProgress ?? []).length > 0 && (
        <>
          <Text style={blockTitle}>En cours ({(t.inProgress ?? []).length})</Text>
          {(t.inProgress ?? []).map((x: any, i: number) => (
            <Text key={i} style={line}>
              • {x.titre}
              {x.contexte ? ` — ${x.contexte}` : ''}
              {x.echeance ? ` · échéance ${x.echeance}` : ''} · depuis {x.depuis} j
            </Text>
          ))}
        </>
      )}

      {(t.upcoming ?? []).length > 0 && (
        <>
          <Text style={blockTitle}>À venir ({(t.upcoming ?? []).length})</Text>
          {(t.upcoming ?? []).map((x: any, i: number) => (
            <Text key={i} style={line}>
              • {x.titre}
              {x.contexte ? ` — ${x.contexte}` : ''}
              {x.echeance ? ` · ${x.echeance}` : ''}
            </Text>
          ))}
        </>
      )}

      {(t.overdue ?? []).length > 0 && (
        <>
          <Text style={blockTitle}>En retard ({(t.overdue ?? []).length})</Text>
          {(t.overdue ?? []).map((x: any, i: number) => (
            <Text key={i} style={line}>
              • {x.titre}
              {x.echeance ? ` · échéance dépassée le ${x.echeance}` : ''}
            </Text>
          ))}
        </>
      )}

      {(t.blocked ?? []).length > 0 && (
        <>
          <Text style={blockTitle}>Bloquées ({(t.blocked ?? []).length})</Text>
          {(t.blocked ?? []).map((x: any, i: number) => (
            <Text key={i} style={line}>
              • {x.titre}
              {x.contexte ? ` — ${x.contexte}` : ''}
            </Text>
          ))}
        </>
      )}

      <Text style={muted}>Taux de complétion : {t.completionRate ?? 0} %</Text>

      {(p.actions ?? []).length > 0 && (
        <>
          <Text style={blockTitle}>Actions réalisées</Text>
          {(p.actions ?? []).map((a: any, i: number) => (
            <React.Fragment key={i}>
              <Text style={{ ...line, fontWeight: 600 }}>
                {a.label} ({a.count})
              </Text>
              {(a.items ?? []).map((it: string, j: number) => (
                <Text key={j} style={muted}>
                  – {it}
                </Text>
              ))}
            </React.Fragment>
          ))}
        </>
      )}

      {(p.contexts ?? []).length > 0 && (
        <>
          <Text style={blockTitle}>Clients / dossiers touchés</Text>
          <Text style={line}>{(p.contexts ?? []).join(' · ')}</Text>
        </>
      )}

      {(p.attention ?? []).length > 0 && (
        <>
          <Text style={blockTitle}>Points d'attention</Text>
          {(p.attention ?? []).map((a: string, i: number) => (
            <Text key={i} style={line}>
              • {a}
            </Text>
          ))}
        </>
      )}
    </Section>
  )
}

export function Email({ dateFr, periode, synthese, classement, personnes, appUrl, pdfUrl }: Props) {
  return (
    <Html>
      <Head />
      <Preview>{`Compte rendu du ${dateFr ?? ''}`}</Preview>
      <Body style={s.main}>
        <Container style={s.container}>
          <Heading style={s.h1}>Compte rendu quotidien</Heading>
          <Text style={s.text}>{dateFr}</Text>
          {periode && <Text style={muted}>Période couverte : {periode}</Text>}

          <Section style={s.card}>
            <Text style={{ ...s.value, marginBottom: 6 }}>Synthèse de l'équipe</Text>
            <Text style={line}>
              {synthese?.connectes ?? 0} personne(s) connectée(s) sur {synthese?.equipe ?? 0} —{' '}
              {synthese?.tempsCumule ?? '0 min'} de connexion cumulée
            </Text>
            {SYNTH.map(([k, label]) => (
              <Text key={k} style={line}>
                {label} : <strong>{synthese?.[k] ?? 0}</strong>
              </Text>
            ))}
            {(classement ?? []).length > 0 && (
              <>
                <Text style={blockTitle}>Classement — tâches terminées</Text>
                {(classement ?? []).map((c, i) => (
                  <Text key={i} style={line}>
                    {i + 1}. {c.nom} — {c.done}
                  </Text>
                ))}
              </>
            )}
          </Section>

          {pdfUrl ? (
            <Section style={{ textAlign: 'center', marginTop: 18, marginBottom: 4 }}>
              <Button href={pdfUrl} style={s.button}>
                Télécharger le rapport PDF
              </Button>
              <Text style={muted}>Lien valable 30 jours.</Text>
            </Section>
          ) : (
            <Text style={{ ...s.warning, marginTop: 16 }}>
              Le rapport PDF n'a pas pu être généré. Le détail complet reste disponible ci-dessous.
            </Text>
          )}

          <Hr style={s.hr} />

          <Text style={{ ...s.value, marginBottom: 4 }}>Détail par personne</Text>

          {(personnes ?? []).length > 0 ? (
            (personnes ?? []).map((p: any, i: number) => <Personne key={i} p={p} />)
          ) : (
            <Text style={muted}>Aucun membre d'équipe enregistré.</Text>
          )}

          {appUrl && (
            <Section style={{ textAlign: 'center', marginTop: 24 }}>
              <Button href={`${appUrl}/admin/rapports-activite`} style={s.button}>
                Ouvrir les rapports d'activité
              </Button>
            </Section>
          )}
          <Hr style={s.hr} />
          <Text style={s.footer}>IZISuivis</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `IZISUIVI - Compte rendu du ${d.dateFr ?? ''}`.trim(),
  displayName: 'Direction — Compte rendu quotidien (par personne)',
  previewData: {
    dateFr: 'vendredi 21 août 2026',
    periode: '21/08/2026, de 00h00 à 19:00',
    synthese: {
      connectes: 2,
      equipe: 3,
      tempsCumule: '9 h 40',
      tachesTerminees: 5,
      tachesEnCours: 4,
      tachesEnRetard: 1,
      dossiersCrees: 2,
      changementsStatut: 3,
      documentsDeposes: 6,
      messages: 24,
      nouveauxClients: 1,
    },
    classement: [
      { nom: 'Nadine Dendani', done: 3 },
      { nom: 'Maher Krimi', done: 2 },
    ],
    personnes: [
      {
        nom: 'Nadine Dendani',
        roles: ['Direction'],
        poles: ['Qualiopi'],
        presence: { dureeLabel: '5 h 20', sessions: 2, premiere: '08:45', derniere: '18:52', lieux: ['Paris'], appareils: ['Mac'] },
        taches: {
          done: [{ titre: 'Relance OF Alpha', contexte: 'Dossier Alpha', priorite: 'haute', heure: '11:20', note: null }],
          inProgress: [{ titre: 'Préparer audit', contexte: 'Dossier Beta', priorite: 'normale', echeance: '25/08/2026', depuis: 3 }],
          upcoming: [],
          overdue: [],
          blocked: [],
          completionRate: 60,
        },
        actions: [{ label: 'Messages clients envoyés', count: 2, items: ['10:12 — Alpha', '15:40 — Beta'] }],
        contexts: ['Dossier Alpha', 'Dossier Beta'],
        attention: ['1 échéance(s) demain : Préparer audit'],
        hasActivity: true,
      },
      {
        nom: 'Jean Martin',
        roles: ['Collaborateur'],
        poles: [],
        presence: { dureeLabel: '0 min', sessions: 0, premiere: null, derniere: null, lieux: [], appareils: [] },
        taches: { done: [], inProgress: [], upcoming: [], overdue: [], blocked: [], completionRate: 0 },
        actions: [],
        contexts: [],
        attention: [],
        hasActivity: false,
      },
    ],
    appUrl: 'https://izisuivis.com',
    pdfUrl: 'https://izisuivis.com/rapport-exemple.pdf',
  },
}
