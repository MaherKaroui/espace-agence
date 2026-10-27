import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  titre?: string
  message?: string
  dossierTitre?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ titre, message, dossierTitre, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>{titre || 'Rappel — Pôle Certification & EDOF'}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>{titre || 'Rappel'}</Heading>
        {message && <Text style={s.text}>{message}</Text>}
        <Section style={s.card}>
          <Text style={s.label}>Dossier</Text>
          <Text style={s.value}>{dossierTitre || '—'}</Text>
        </Section>
        {dossierId && appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/pole-certification/${dossierId}`} style={s.button}>Ouvrir le dossier</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis — Pôle Certification &amp; EDOF, rappel automatique</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `IZISuivis — ${d.titre || 'Rappel Pôle Certification & EDOF'}`,
  displayName: 'Équipe — Rappel Pôle Certification & EDOF',
  previewData: { titre: 'Échéance dans 3 jours : Étape 3 — Dossier envoyé au certificateur', message: 'Échéance le 30/10/2026.', dossierTitre: 'Titre RS — Formateur numérique' },
} satisfies TemplateEntry
