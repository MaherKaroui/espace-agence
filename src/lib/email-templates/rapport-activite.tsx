import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  role?: string
  periode?: string
  done?: number
  inProgress?: number
  upcoming?: number
  overdue?: number
  completionRate?: number
  doneTitles?: string[]
  contexts?: string[]
  appUrl?: string
}

const Email = ({ prenom, role, periode, done, inProgress, upcoming, overdue, completionRate, doneTitles, contexts, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Rapport d'activité — {periode || ''}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Rapport d'activité</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Voici le récapitulatif de l'activité{role ? ` (${role})` : ''} pour la période : <b>{periode || ''}</b>.
        </Text>

        <Section style={s.card}>
          <Text style={s.label}>Synthèse</Text>
          <Text style={s.text}>Tâches terminées : <b>{done ?? 0}</b></Text>
          <Text style={s.text}>Tâches en cours : <b>{inProgress ?? 0}</b></Text>
          <Text style={s.text}>Tâches à venir : <b>{upcoming ?? 0}</b></Text>
          <Text style={s.text}>Tâches en retard : <b>{overdue ?? 0}</b></Text>
          <Text style={s.text}>Taux de complétion : <b>{completionRate ?? 0}%</b></Text>
        </Section>

        {doneTitles && doneTitles.length > 0 ? (
          <Section style={s.card}>
            <Text style={s.label}>Ce qui a été fait</Text>
            {doneTitles.map((t, i) => (
              <Text key={i} style={s.text}>• {t}</Text>
            ))}
          </Section>
        ) : (
          <Section style={s.callout}>Aucune activité enregistrée sur la période.</Section>
        )}

        {contexts && contexts.length > 0 ? (
          <Section style={s.card}>
            <Text style={s.label}>Projets / clients concernés</Text>
            <Text style={s.text}>{contexts.join(' · ')}</Text>
          </Section>
        ) : null}

        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/admin/rapports-activite`} style={s.button}>Ouvrir le rapport complet</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `IZISUIVI – Rapport d'activité${d.periode ? ` (${d.periode})` : ''}`,
  displayName: 'Équipe — Rapport d’activité',
  previewData: {
    prenom: 'Nadine',
    role: 'Direction',
    periode: "Aujourd'hui",
    done: 5,
    inProgress: 3,
    upcoming: 2,
    overdue: 1,
    completionRate: 62,
    doneTitles: ['Préparer l’audit ABC Formation', 'Relance client DEF', 'Validation des preuves indicateur 4'],
    contexts: ['ABC Formation', 'DEF Conseil'],
    appUrl: 'https://izisuivis.com',
  },
} satisfies TemplateEntry
