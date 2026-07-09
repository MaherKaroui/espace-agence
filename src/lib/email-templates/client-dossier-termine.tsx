import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  dossierTitre?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ prenom, dossierTitre, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Votre dossier est terminé 🎉</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Votre dossier est terminé 🎉</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.success}>
          Excellente nouvelle : votre dossier <b>{dossierTitre || ''}</b> est désormais finalisé.
        </Text>
        <Text style={s.text}>Merci pour votre confiance. Vous pouvez retrouver l'ensemble des pièces et de l'historique depuis votre espace.</Text>
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Voir mon dossier</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis — au plaisir de vous accompagner à nouveau.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Votre dossier${d.dossierTitre ? ` « ${d.dossierTitre} »` : ''} est terminé`,
  displayName: 'Client — Dossier terminé',
  previewData: { prenom: 'Marie', dossierTitre: 'Certification Qualiopi', dossierId: 'demo', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
