import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  dossierTitre?: string
  message?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ prenom, dossierTitre, message, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Action requise sur votre dossier</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Action requise</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.warning}>
          Nous attendons une action de votre part pour poursuivre le traitement de votre dossier <b>{dossierTitre || ''}</b>.
        </Text>
        {message && <Text style={s.callout}>{message}</Text>}
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Ouvrir mon dossier</Button>
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
  subject: (d: Record<string, any>) => `Action requise : votre dossier${d.dossierTitre ? ` « ${d.dossierTitre} »` : ''}`,
  displayName: 'Client — En attente client',
  previewData: { prenom: 'Marie', dossierTitre: 'Certification Qualiopi', message: 'Il manque encore quelques éléments pour finaliser votre dossier.', dossierId: 'demo', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
