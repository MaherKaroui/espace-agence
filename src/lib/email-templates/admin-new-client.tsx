import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  clientName?: string
  clientEmail?: string
  appUrl?: string
}

const Email = ({ clientName, clientEmail, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Nouveau client inscrit sur IZI Business</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Nouveau client</Heading>
        <Text style={text}>Un nouveau client vient de créer un compte.</Text>
        <Section style={card}>
          <Text style={label}>Nom</Text>
          <Text style={value}>{clientName || '—'}</Text>
          <Text style={label}>Email</Text>
          <Text style={value}>{clientEmail || '—'}</Text>
        </Section>
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/admin/clients`} style={button}>Voir les clients</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>IZI Business — notification automatique</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'Nouveau client inscrit',
  displayName: 'Admin — Nouveau client',
  to: 'admin@izi-business.com',
  previewData: { clientName: 'Marie Dupont', clientEmail: 'marie@example.com' },
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
