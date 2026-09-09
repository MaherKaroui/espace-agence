import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr, Link } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Piece {
  name: string
  url: string
}

interface Props {
  prenom?: string
  titre?: string
  message?: string
  pieces?: Piece[]
  appUrl?: string
}

const Email = ({ prenom, titre, message, pieces, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>{titre || 'Un message de votre agence'}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>{titre || 'Un message de votre agence'}</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        {(message || '').split('\n').filter(Boolean).map((p, i) => (
          <Text key={i} style={s.text}>{p}</Text>
        ))}
        {pieces && pieces.length > 0 && (
          <Section style={s.card}>
            <Text style={s.label}>Pièces jointes</Text>
            {pieces.map((p, i) => (
              <Text key={i} style={s.value}>
                <Link href={p.url} style={{ color: '#0f172a' }}>{p.name}</Link>
              </Text>
            ))}
          </Section>
        )}
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/messages`} style={s.button}>Ouvrir ma messagerie</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis — vos échanges avec votre agence, centralisés et sécurisés.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) => `IZISuivis — ${data?.titre || 'Message de votre agence'}`,
  displayName: 'Client — Annonce / diffusion',
  previewData: {
    prenom: 'Marie',
    titre: 'Mise à jour importante',
    message: 'Bonjour,\nVoici les informations concernant vos démarches en cours.',
    pieces: [{ name: 'note-information.pdf', url: 'https://izisuivis.com' }],
    appUrl: 'https://izisuivis.com',
  },
} satisfies TemplateEntry
