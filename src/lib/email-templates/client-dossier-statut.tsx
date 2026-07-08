import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  dossierTitre?: string
  statutLabel?: string
  explication?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ prenom, dossierTitre, statutLabel, explication, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Votre dossier avance — nouveau statut : {statutLabel || 'mis à jour'}</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Votre dossier avance</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Le statut de votre dossier <b>{dossierTitre || ''}</b> vient d'être mis à jour.
        </Text>
        <Section style={s.card}>
          <Text style={s.label}>Nouveau statut</Text>
          <Text style={s.value}>{statutLabel || 'Mis à jour'}</Text>
        </Section>
        {explication && <Text style={s.callout}>{explication}</Text>}
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Voir mon dossier</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis · IZI Business</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Votre dossier ${d.dossierTitre ? `« ${d.dossierTitre} » ` : ''}avance : ${d.statutLabel || 'mis à jour'}`,
  displayName: 'Client — Statut dossier',
  previewData: { prenom: 'Marie', dossierTitre: 'Certification Qualiopi', statutLabel: 'En cours de traitement', explication: "Votre dossier est désormais en cours de traitement par notre équipe.", dossierId: 'demo', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
