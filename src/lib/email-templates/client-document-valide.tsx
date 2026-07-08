import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  dossierTitre?: string
  documentNom?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ prenom, dossierTitre, documentNom, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Bonne nouvelle — votre document a été validé</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Document validé ✅</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.success}>
          Bonne nouvelle : votre document <b>{documentNom || ''}</b> a été validé par notre équipe.
        </Text>
        <Section style={s.card}>
          <Text style={s.label}>Dossier</Text>
          <Text style={s.value}>{dossierTitre || ''}</Text>
        </Section>
        <Text style={s.text}>Nous poursuivons le traitement de votre dossier.</Text>
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Voir mon dossier</Button>
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
  subject: (d: Record<string, any>) => `Document validé : ${d.documentNom || 'votre pièce jointe'}`,
  displayName: 'Client — Document validé',
  previewData: { prenom: 'Marie', dossierTitre: 'Certification Qualiopi', documentNom: 'Attestation URSSAF.pdf', dossierId: 'demo', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
