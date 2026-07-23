import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  dateLabel?: string
  delayLabel?: string
  appUrl?: string
}

const Email = ({ prenom, dateLabel, delayLabel, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Rappel de votre rendez-vous</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Rappel de rendez-vous</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Nous vous rappelons votre rendez-vous prévu <b>{delayLabel || 'prochainement'}</b>
          {dateLabel ? <> le <b>{dateLabel}</b></> : null}.
        </Text>
        <Text style={s.callout}>
          En cas d'imprévu, merci de nous prévenir au plus tôt depuis votre espace.
        </Text>
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/rendez-vous`} style={s.button}>Voir mes rendez-vous</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Rappel : rendez-vous ${d.delayLabel || 'à venir'}`,
  displayName: 'Client — Rappel rendez-vous',
  previewData: { prenom: 'Marie', dateLabel: 'lundi 5 août à 10h00', delayLabel: 'demain', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
