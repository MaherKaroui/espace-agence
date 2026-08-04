import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  groupTitre?: string
  invitedBy?: string
  link?: string
  appUrl?: string
}

const Email = ({ groupTitre, invitedBy, link, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Vous avez été ajouté à un groupe de discussion</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Nouveau groupe de discussion</Heading>
        <Text style={s.text}>
          {invitedBy ? <strong>{invitedBy}</strong> : 'Un membre de l\u2019équipe'} vous a ajouté au groupe{' '}
          <strong>{groupTitre || 'de discussion'}</strong> sur IZISuivis.
        </Text>
        <Section style={s.card}>
          <Text style={s.label}>Groupe</Text>
          <Text style={s.value}>{groupTitre || 'Groupe de discussion'}</Text>
        </Section>
        {link && appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}${link}`} style={s.button}>Ouvrir le groupe</Button>
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
  subject: (d: Record<string, any>) => `IZISuivis — Vous avez été ajouté au groupe ${d.groupTitre || 'de discussion'}`,
  displayName: 'Groupe — Ajout au groupe',
  previewData: { groupTitre: 'Pôle Qualiopi', invitedBy: 'Nadine Dendani', link: '/messages/groupes' },
} satisfies TemplateEntry
