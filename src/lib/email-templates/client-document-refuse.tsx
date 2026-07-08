import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  dossierTitre?: string
  documentNom?: string
  commentaire?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ prenom, dossierTitre, documentNom, commentaire, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Un document est à corriger</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Document à corriger</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Le document <b>{documentNom || ''}</b> de votre dossier <b>{dossierTitre || ''}</b> nécessite une correction.
        </Text>
        {commentaire && (
          <Section style={s.warning}>
            <Text style={{ ...s.text, margin: 0 }}><b>Motif :</b> {commentaire}</Text>
          </Section>
        )}
        <Text style={s.text}>Merci de renvoyer une version corrigée depuis votre espace.</Text>
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Renvoyer le document</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis · IZI Business — pas d'inquiétude, notre équipe est là pour vous aider.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Document à corriger : ${d.documentNom || 'votre pièce jointe'}`,
  displayName: 'Client — Document à corriger',
  previewData: { prenom: 'Marie', dossierTitre: 'Certification Qualiopi', documentNom: 'Attestation URSSAF.pdf', commentaire: 'Le document doit être daté de moins de 3 mois.', dossierId: 'demo', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
