import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  prenom?: string
  appUrl?: string
}

const Email = ({ prenom, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Bienvenue sur IZISuivis</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Bienvenue{prenom ? ` ${prenom}` : ''} 👋</Heading>
        <Text style={text}>
          Nous sommes ravis de vous accueillir sur votre espace IZISuivis. Vous pouvez dès à présent créer vos dossiers, échanger avec l'équipe et prendre rendez-vous en quelques clics.
        </Text>
        <Section style={card}>
          <Text style={value}>Prochaines étapes :</Text>
          <Text style={text}>• Complétez votre profil</Text>
          <Text style={text}>• Créez votre premier dossier</Text>
          <Text style={text}>• Prenez rendez-vous avec l'agence</Text>
        </Section>
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dashboard`} style={button}>Accéder à mon espace</Button>
          </Section>
        )}
        <Hr style={hr} />
        <Text style={footer}>L'équipe IZISuivis est à vos côtés à chaque étape.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'Bienvenue sur IZISuivis',
  displayName: 'Client — Bienvenue',
  previewData: { prenom: 'Marie', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#334155', lineHeight: '22px', margin: '4px 0' }
const card = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', marginTop: '16px' }
const value = { fontSize: '15px', color: '#0f172a', margin: '0 0 8px', fontWeight: 600 }
const button = { background: '#0f172a', color: '#ffffff', padding: '12px 20px', borderRadius: '6px', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }
const hr = { borderTop: '1px solid #e2e8f0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94a3b8', textAlign: 'center' as const }
