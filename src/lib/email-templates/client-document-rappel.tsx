import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  docNom?: string
  dossierTitre?: string
  dossierId?: string
  delayLabel?: string
  appUrl?: string
}

const Email = ({ prenom, docNom, dossierTitre, dossierId, delayLabel, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Rappel : document à transmettre</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Rappel — document à transmettre</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Nous attendons toujours le document <b>{docNom || ''}</b> pour votre dossier
          {dossierTitre ? <> <b>« {dossierTitre} »</b></> : null}.
          {delayLabel ? <> Cette demande est ouverte depuis <b>{delayLabel}</b>.</> : null}
        </Text>
        <Text style={s.callout}>
          Merci de le déposer dès que possible depuis votre espace pour éviter tout retard sur votre dossier.
        </Text>
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Déposer le document</Button>
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
  subject: (d: Record<string, any>) => `Rappel : merci de transmettre « ${d.docNom || 'votre document'} »`,
  displayName: 'Client — Rappel document manquant',
  previewData: { prenom: 'Marie', docNom: 'Kbis', dossierTitre: 'Certification Qualiopi', dossierId: 'demo', delayLabel: '3 jours', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
