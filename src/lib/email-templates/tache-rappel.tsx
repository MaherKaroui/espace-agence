import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  titre?: string
  description?: string
  poleNom?: string
  poleCouleur?: string
  echeance?: string
  priorite?: string
  statut?: string
  contexte?: string
  enRetard?: boolean
  appUrl?: string
}

const Email = ({ prenom, titre, description, poleNom, poleCouleur, echeance, priorite, statut, contexte, enRetard, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>{enRetard ? 'Tâche en retard' : 'Rappel de tâche'} — {titre || ''}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>{enRetard ? 'Tâche en retard' : 'Rappel de tâche'}</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          {contexte || (enRetard ? "Cette tâche a dépassé son échéance et n'est pas terminée." : "Cette tâche arrive à échéance.")}
        </Text>
        <Section
          style={{
            borderLeft: `4px solid ${poleCouleur || '#2563eb'}`,
            padding: '12px 16px',
            background: '#f8fafc',
            borderRadius: 6,
            margin: '16px 0',
          }}
        >
          <Text style={{ ...s.text, margin: 0, fontWeight: 700 }}>{titre || ''}</Text>
          {description ? <Text style={{ ...s.text, margin: '6px 0 0' }}>{description}</Text> : null}
          <Text style={{ ...s.text, margin: '8px 0 0', fontSize: 13, color: '#475569' }}>
            {poleNom ? <>Pôle : <b>{poleNom}</b><br /></> : null}
            {echeance ? <>Échéance : <b>{echeance}</b><br /></> : null}
            {priorite ? <>Priorité : <b>{priorite}</b><br /></> : null}
            {statut ? <>Statut : <b>{statut}</b></> : null}
          </Text>
        </Section>
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/admin/taches-agence`} style={s.button}>Ouvrir la tâche</Button>
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
  subject: (d: Record<string, any>) =>
    d.enRetard
      ? `IZISUIVI – Tâche en retard${d.poleNom ? ` ${d.poleNom}` : ''} : ${d.titre || ''}`
      : `IZISUIVI – Rappel tâche${d.poleNom ? ` ${d.poleNom}` : ''} : ${d.titre || ''}`,
  displayName: 'Équipe — Rappel de tâche',
  previewData: {
    prenom: 'Nadine',
    titre: 'Préparer l’audit Qualiopi ABC Formation',
    description: 'Vérifier les preuves des indicateurs 1 à 5.',
    poleNom: 'Qualiopi',
    poleCouleur: '#2563eb',
    echeance: 'demain à 09:00',
    priorite: 'Haute',
    statut: 'En cours',
    enRetard: false,
    appUrl: 'https://izisuivis.com',
  },
} satisfies TemplateEntry
