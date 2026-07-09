import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  clientName?: string
  clientEmail?: string
  dossierTitre?: string
  categorie?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ clientName, clientEmail, dossierTitre, categorie, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Nouveau dossier créé sur IZISuivis</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Nouveau dossier</Heading>
        <Text style={text}>Un client vient de créer un nouveau dossier sur l'espace IZISuivis.</Text>
        <Section style={card}>
          <Text style={label}>Client</Text>
          <Text style={value}>{clientName || 'Client'} {clientEmail ? `— ${clientEmail}` : ''}</Text>
          <Text style={label}>Titre</Text>
          <Text style={value}>{dossierTitre || '—'}</Text>
          {categorie && (<><Text style={label}>Catégorie</Text><Text style={value}>{categorie}</Text></>)}
        </Section>
        {dossierId && appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/admin/dossiers/${dossierId}`} style={button}>Ouvrir le dossier</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>IZISuivis — notification automatique</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Nouveau dossier${d.dossierTitre ? ` : ${d.dossierTitre}` : ''}`,
  displayName: 'Admin — Nouveau dossier',
  to: 'admin@izisuivis.com',
  previewData: { clientName: 'Marie Dupont', clientEmail: 'marie@example.com', dossierTitre: 'Certification Qualiopi', categorie: 'qualiopi' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '22px' }
const card = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginTop: '16px' }
const label = { fontSize: '11px', textTransform: 'uppercase' as const, color: '#64748b', margin: '8px 0 2px', letterSpacing: '0.5px' }
const value = { fontSize: '15px', color: '#0f172a', margin: 0, fontWeight: 500 }
const button = { background: '#0f172a', color: '#ffffff', padding: '12px 20px', borderRadius: '6px', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }
const hr = { borderTop: '1px solid #e2e8f0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94a3b8', textAlign: 'center' as const }
