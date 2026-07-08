import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  dossierTitre?: string
  documentLabel?: string
  message?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ prenom, dossierTitre, documentLabel, message, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Un document est requis pour votre dossier</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Un document est requis</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Pour faire avancer votre dossier <b>{dossierTitre || ''}</b>, nous avons besoin d'un document supplémentaire.
        </Text>
        <Section style={s.card}>
          <Text style={s.label}>Document demandé</Text>
          <Text style={s.value}>{documentLabel || 'Document complémentaire'}</Text>
        </Section>
        {message && <Text style={s.callout}>{message}</Text>}
        <Text style={s.text}>Vous pouvez le déposer directement depuis votre espace en quelques clics.</Text>
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Déposer le document</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis · IZI Business</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Document requis pour votre dossier${d.dossierTitre ? ` « ${d.dossierTitre} »` : ''}`,
  displayName: 'Client — Document demandé',
  previewData: { prenom: 'Marie', dossierTitre: 'Certification Qualiopi', documentLabel: 'Attestation URSSAF', message: 'Merci de nous transmettre l\'attestation URSSAF datée de moins de 3 mois.', dossierId: 'demo', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
