import React from 'react'
import { Body, Container, Head, Html, Preview, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  subject?: string
  body?: string
}

// Courrier sobre adressé à un certificateur Qualiopi : le texte est rédigé
// (et éventuellement retouché) dans le calendrier Qualiopi, rendu tel quel.
const Email = ({ subject, body }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>{subject || 'Certificat Qualiopi'}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        {(body || '').split(/\n{2,}/).map((para, i) => (
          <Text key={i} style={{ ...s.text, margin: '0 0 12px' }}>
            {para.split('\n').map((line, j, arr) => (
              <React.Fragment key={j}>
                {line}
                {j < arr.length - 1 && <br />}
              </React.Fragment>
            ))}
          </Text>
        ))}
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) => data?.subject || 'Certificat Qualiopi',
  displayName: 'Certificateur — Demande / relance de certificat',
  previewData: {
    subject: 'Demande de certificat Qualiopi — ORGANISME EXEMPLE — audit du 01/10/2026',
    body: "Bonjour,\n\nJe me permets de revenir vers vous au sujet de l'audit initial Qualiopi de l'organisme ORGANISME EXEMPLE.\n\nBien cordialement,\nPrénom Nom",
  },
} satisfies TemplateEntry
