import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  clientName?: string
  dossierTitre?: string
  documentNom?: string
  poleName?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ clientName, dossierTitre, documentNom, poleName, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Nouveau document à vérifier</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Document déposé par un client</Heading>
        <Text style={s.text}>Un client vient de déposer un document en attente de vérification.</Text>
        <Section style={s.card}>
          <Text style={s.label}>Client</Text>
          <Text style={s.value}>{clientName || 'Client'}</Text>
          <Text style={s.label}>Dossier</Text>
          <Text style={s.value}>{dossierTitre || '—'}</Text>
          {documentNom && (<><Text style={s.label}>Document</Text><Text style={s.value}>{documentNom}</Text></>)}
          {poleName && (<><Text style={s.label}>Pôle</Text><Text style={s.value}>{poleName}</Text></>)}
        </Section>
        {dossierId && appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/admin/dossiers/${dossierId}`} style={s.button}>Vérifier le document</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis — notification équipe automatique</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'IZISuivis — Nouveau document à vérifier',
  displayName: 'Équipe — Document déposé par un client',
  previewData: { clientName: 'Marie Dupont', dossierTitre: 'Certification Qualiopi', documentNom: 'kbis.pdf', poleName: 'Qualiopi' },
} satisfies TemplateEntry
