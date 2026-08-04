import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  groupTitre?: string
  senderName?: string
  extrait?: string
  link?: string
  appUrl?: string
}

const Email = ({ groupTitre, senderName, extrait, link, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Nouveau message dans votre groupe</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Nouveau message de groupe</Heading>
        <Text style={s.text}>
          <strong>{senderName || 'Un membre'}</strong> a écrit dans le groupe{' '}
          <strong>{groupTitre || 'de discussion'}</strong>.
        </Text>
        {extrait && (
          <Section style={s.card}>
            <Text style={s.label}>Extrait</Text>
            <Text style={s.value}>{extrait}</Text>
          </Section>
        )}
        {link && appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}${link}`} style={s.button}>Ouvrir la discussion</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis — notification automatique</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `IZISuivis — Nouveau message dans ${d.groupTitre || 'votre groupe'}`,
  displayName: 'Groupe — Nouveau message',
  previewData: { groupTitre: 'Pôle Qualiopi', senderName: 'Nadine Dendani', extrait: 'Bonjour à tous, le point audit est décalé…', link: '/messages/groupes' },
} satisfies TemplateEntry
