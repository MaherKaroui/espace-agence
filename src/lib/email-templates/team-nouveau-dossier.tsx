import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  clientName?: string
  clientEmail?: string
  dossierTitre?: string
  categorie?: string
  poleName?: string
  statut?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ clientName, clientEmail, dossierTitre, categorie, poleName, statut, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Nouveau dossier dans votre pôle {poleName || ''}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Nouveau dossier dans votre pôle</Heading>
        <Text style={s.text}>Un nouveau dossier vient d'arriver dans votre pôle sur IZISuivis.</Text>
        <Section style={s.card}>
          <Text style={s.label}>Client</Text>
          <Text style={s.value}>{clientName || 'Client'}{clientEmail ? ` — ${clientEmail}` : ''}</Text>
          <Text style={s.label}>Dossier</Text>
          <Text style={s.value}>{dossierTitre || '—'}</Text>
          {categorie && (<><Text style={s.label}>Catégorie</Text><Text style={s.value}>{categorie}</Text></>)}
          {poleName && (<><Text style={s.label}>Pôle</Text><Text style={s.value}>{poleName}</Text></>)}
          {statut && (<><Text style={s.label}>Statut initial</Text><Text style={s.value}>{statut}</Text></>)}
        </Section>
        {dossierId && appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/admin/dossiers/${dossierId}`} style={s.button}>Ouvrir le dossier</Button>
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
  subject: (d: Record<string, any>) => `IZISuivis — Nouveau dossier${d.poleName ? ` (${d.poleName})` : ''}`,
  displayName: 'Équipe — Nouveau dossier dans le pôle',
  previewData: { clientName: 'Marie Dupont', clientEmail: 'marie@example.com', dossierTitre: 'Certification Qualiopi', categorie: 'Qualiopi', poleName: 'Qualiopi', statut: 'Nouveau' },
} satisfies TemplateEntry
