import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  prenom?: string
  dossierTitre?: string
  message?: string
  appUrl?: string
}

const Email = ({ prenom, dossierTitre, message, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Relance concernant {dossierTitre ?? 'votre dossier'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Bonjour{prenom ? ` ${prenom}` : ''},</Heading>
        <Text style={text}>
          Sans nouvelle de votre part, nous nous permettons de vous relancer concernant{' '}
          <strong>{dossierTitre ?? 'votre dossier'}</strong>.
        </Text>
        {message && (
          <Section style={card}>
            <Text style={text}>{message}</Text>
          </Section>
        )}
        <Text style={text}>
          Merci de vous connecter à votre espace IZISuivis pour répondre ou déposer les éléments demandés.
        </Text>
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/messages`} style={button}>Accéder à mon espace</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>IZISuivis — l'équipe reste à votre disposition.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Relance — ${d.dossierTitre ?? 'votre dossier'}`,
  displayName: 'Client — Relance',
  previewData: {
    prenom: 'Marie',
    dossierTitre: 'Certification Qualiopi',
    message: 'Sans nouvelle de votre part, nous vous relançons concernant votre dossier.',
    appUrl: 'https://izisuivis.com',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '22px', margin: '8px 0' }
const card = { background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '16px', marginTop: '12px' }
const button = { background: '#0f172a', color: '#ffffff', padding: '12px 20px', borderRadius: '6px', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }
const hr = { borderTop: '1px solid #e2e8f0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94a3b8', textAlign: 'center' as const }
