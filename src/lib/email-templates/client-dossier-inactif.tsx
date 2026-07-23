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
    <Preview>Votre dossier attend une action</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Votre dossier attend une action</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Nous n'avons pas eu d'activité sur votre dossier <b>{dossierTitre || ''}</b> depuis plusieurs jours.
        </Text>
        <Text style={s.callout}>
          Merci de vous connecter pour vérifier les documents demandés et échanger avec votre conseiller.
        </Text>
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Ouvrir mon dossier</Button>
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
  subject: (d: Record<string, any>) => `Votre dossier${d.dossierTitre ? ` « ${d.dossierTitre} »` : ''} attend une action`,
  displayName: 'Client — Dossier inactif',
  previewData: { prenom: 'Marie', dossierTitre: 'Certification Qualiopi', dossierId: 'demo', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
