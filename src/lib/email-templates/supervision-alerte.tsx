import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  titre?: string
  detail?: string
  gravite?: string
  page?: string
  dateFr?: string
  appUrl?: string
}

const Email = ({ titre, detail, gravite, page, dateFr, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>{`Alerte izisuivis — ${titre ?? ''}`}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Alerte de supervision</Heading>
        <Text style={s.text}>{dateFr || ''}</Text>
        <Section style={s.card}>
          <Text style={s.label}>Gravité</Text>
          <Text style={s.value}>{gravite || 'critique'}</Text>
          <Text style={s.label}>Problème</Text>
          <Text style={s.value}>{titre || ''}</Text>
          {page ? (<><Text style={s.label}>Page</Text><Text style={s.value}>{page}</Text></>) : null}
          {detail ? (<><Text style={s.label}>Détail</Text><Text style={s.text}>{detail}</Text></>) : null}
        </Section>
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/admin/agent-ia`} style={s.button}>Voir dans l'Agent IA</Button>
          </Section>
        )}
      </Container>
    </Body>
  </Html>
)

export const template: TemplateEntry = {
  component: Email,
  subject: (d) => `ALERTE izisuivis - ${d?.titre ?? 'incident détecté'}`,
  displayName: 'Supervision — alerte immédiate',
  previewData: { titre: 'Site inaccessible', gravite: 'critique', detail: 'HTTP 503', dateFr: '19/08/2026 14:02' },
}
