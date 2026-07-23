import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  clientName?: string
  extrait?: string
  clientId?: string
  appUrl?: string
}

const Email = ({ clientName, extrait, clientId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Nouveau message d'un client</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Nouveau message d'un client</Heading>
        <Text style={s.text}><strong>{clientName || 'Un client'}</strong> vient de vous répondre sur IZISuivis.</Text>
        {extrait && (
          <Section style={s.card}>
            <Text style={s.label}>Extrait</Text>
            <Text style={s.value}>{extrait}</Text>
          </Section>
        )}
        {clientId && appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/admin/messages/${clientId}`} style={s.button}>Ouvrir la conversation</Button>
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
  subject: (d: Record<string, any>) => `IZISuivis — Nouveau message de ${d.clientName || 'votre client'}`,
  displayName: 'Équipe — Message client',
  previewData: { clientName: 'Marie Dupont', extrait: 'Bonjour, j\'ai bien reçu votre demande...' },
} satisfies TemplateEntry
