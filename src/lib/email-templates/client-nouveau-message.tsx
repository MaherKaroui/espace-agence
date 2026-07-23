import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  extrait?: string
  clientId?: string
  appUrl?: string
}

const Email = ({ prenom, extrait, clientId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Vous avez un nouveau message de votre agence</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Nouveau message de votre agence</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Votre agence vient de vous envoyer un nouveau message sur IZISuivis.
        </Text>
        {extrait && (
          <Section style={s.card}>
            <Text style={s.label}>Extrait</Text>
            <Text style={s.value}>{extrait}</Text>
          </Section>
        )}
        <Text style={s.text}>Connectez-vous pour lire le message complet et y répondre en toute sécurité.</Text>
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/messages`} style={s.button}>Voir le message</Button>
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
  subject: 'IZISuivis — Nouveau message de votre agence',
  displayName: 'Client — Nouveau message agence',
  previewData: { prenom: 'Marie', extrait: 'Bonjour, nous avons bien reçu vos documents et...', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
