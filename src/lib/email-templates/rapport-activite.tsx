import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Membre {
  nom: string
  done: number
  inProgress: number
  overdue: number
  completionRate: number
  contexts?: string[]
  doneTitles?: string[]
}

interface Props {
  periode?: string
  synthese?: Record<string, number>
  membres?: Membre[]
  attention?: { label: string; count: number; gravite?: string }[]
  demain?: { echeances?: string[]; rdv?: string[] }
  appUrl?: string
}

const SYNTHESE_LABELS: Record<string, string> = {
  dossiersCrees: 'Dossiers créés',
  changementsStatut: 'Changements de statut',
  documentsDeposes: 'Documents déposés',
  messagesClient: 'Messages clients',
  messagesInternes: 'Messages internes',
  messagesGroupe: 'Messages de groupe',
  nouveauxClients: 'Nouveaux clients',
  rdvTenus: 'Rendez-vous tenus',
  rdvAVenir: 'Rendez-vous à venir',
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.text}>{children}</Text>
)

const Email = ({ periode, synthese, membres, attention, demain, appUrl }: Props) => {
  const syntheseRows = Object.entries(synthese ?? {}).filter(([k]) => k in SYNTHESE_LABELS)
  const hasSynthese = syntheseRows.some(([, v]) => Number(v) > 0)
  return (
    <Html lang="fr">
      <Head />
      <Preview>Rapport d'activité — {periode || ''}</Preview>
      <Body style={s.main}>
        <Container style={s.container}>
          <Heading style={s.h1}>Rapport d'activité</Heading>
          <Text style={s.text}>
            Récapitulatif de l'activité IZISuivis pour la période : <b>{periode || ''}</b>.
          </Text>

          <Section style={s.card}>
            <Text style={s.label}>1. Synthèse</Text>
            {hasSynthese ? (
              syntheseRows.map(([k, v]) => (
                <Text key={k} style={s.text}>
                  {SYNTHESE_LABELS[k]} : <b>{v ?? 0}</b>
                </Text>
              ))
            ) : (
              <Empty>Aucune activité sur la période.</Empty>
            )}
          </Section>

          <Section style={s.card}>
            <Text style={s.label}>2. Par collaborateur</Text>
            {membres && membres.length > 0 ? (
              membres.map((m, i) => (
                <Section key={i} style={{ marginBottom: 12 }}>
                  <Text style={s.text}>
                    <b>{m.nom}</b> — {m.done} terminée(s) · {m.inProgress} en cours · {m.overdue} en retard ·{' '}
                    {m.completionRate}% de complétion
                  </Text>
                  {m.doneTitles && m.doneTitles.length > 0 ? (
                    <Text style={s.text}>{m.doneTitles.map((t) => `• ${t}`).join('  ')}</Text>
                  ) : null}
                  {m.contexts && m.contexts.length > 0 ? (
                    <Text style={s.text}>Clients / dossiers : {m.contexts.join(' · ')}</Text>
                  ) : null}
                </Section>
              ))
            ) : (
              <Empty>Aucune activité sur la période.</Empty>
            )}
          </Section>

          <Section style={s.card}>
            <Text style={s.label}>3. Points d'attention</Text>
            {attention && attention.length > 0 ? (
              attention.map((a, i) => (
                <Text key={i} style={s.text}>
                  • {a.label} : <b>{a.count}</b>
                  {a.gravite ? ` (${a.gravite})` : ''}
                </Text>
              ))
            ) : (
              <Empty>Aucun point d'attention sur la période.</Empty>
            )}
          </Section>

          <Section style={s.card}>
            <Text style={s.label}>4. Demain</Text>
            {(demain?.echeances?.length ?? 0) > 0 ? (
              demain!.echeances!.map((t, i) => (
                <Text key={i} style={s.text}>• Échéance : {t}</Text>
              ))
            ) : (
              <Empty>Aucune échéance demain.</Empty>
            )}
            {(demain?.rdv?.length ?? 0) > 0 ? (
              demain!.rdv!.map((t, i) => (
                <Text key={i} style={s.text}>• Rendez-vous : {t}</Text>
              ))
            ) : (
              <Empty>Aucun rendez-vous programmé demain.</Empty>
            )}
          </Section>

          {appUrl && (
            <Section style={{ textAlign: 'center', marginTop: 24 }}>
              <Button href={`${appUrl}/admin/rapports-activite`} style={s.button}>
                Ouvrir le rapport complet
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
  subject: (d: Record<string, any>) => `IZISUIVI – Rapport d'activité${d.periode ? ` (${d.periode})` : ''}`,
  displayName: 'Direction — Rapport d’activité quotidien',
  previewData: {
    periode: '21/08/2026',
    synthese: {
      dossiersCrees: 3,
      changementsStatut: 5,
      documentsDeposes: 7,
      messagesClient: 12,
      messagesInternes: 9,
      messagesGroupe: 4,
      nouveauxClients: 1,
      rdvTenus: 2,
      rdvAVenir: 3,
    },
    membres: [
      {
        nom: 'Nadine Dendani',
        done: 5,
        inProgress: 3,
        overdue: 1,
        completionRate: 62,
        contexts: ['ABC Formation', 'DEF Conseil'],
        doneTitles: ['Préparer l’audit ABC Formation', 'Relance client DEF'],
      },
    ],
    attention: [{ label: 'Tâches en retard depuis plus de 7 jours', count: 4, gravite: 'critique' }],
    demain: { echeances: ['Envoyer le devis GHI'], rdv: ['10:00 — Audit ABC Formation'] },
    appUrl: 'https://izisuivis.com',
  },
} satisfies TemplateEntry
