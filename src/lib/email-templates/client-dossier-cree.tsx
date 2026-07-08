import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Props {
  prenom?: string
  dossierTitre?: string
  categorie?: string
  dossierId?: string
  appUrl?: string
}

const Email = ({ prenom, dossierTitre, categorie, dossierId, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Votre dossier a bien été créé sur IZISuivis</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Votre dossier a bien été créé</Heading>
        <Text style={s.text}>Bonjour {prenom || ''},</Text>
        <Text style={s.text}>
          Nous avons bien reçu votre demande. Votre dossier est enregistré et un conseiller va s'en occuper très prochainement.
        </Text>
        <Section style={s.card}>
          <Text style={s.label}>Dossier</Text>
          <Text style={s.value}>{dossierTitre || 'Nouveau dossier'}</Text>
          {categorie && (<><Text style={s.label}>Catégorie</Text><Text style={s.value}>{categorie}</Text></>)}
        </Section>
        <Text style={s.callout}>
          Prochaine étape : nous allons analyser votre dossier et vous demander, si nécessaire, les documents manquants.
        </Text>
        {appUrl && dossierId && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/dossiers/${dossierId}`} style={s.button}>Voir mon dossier</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis · IZI Business — l'équipe est à vos côtés à chaque étape.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Votre dossier ${d.dossierTitre ? `« ${d.dossierTitre} » ` : ''}a bien été créé`,
  displayName: 'Client — Dossier créé',
  previewData: { prenom: 'Marie', dossierTitre: 'Certification Qualiopi', categorie: 'qualiopi', dossierId: 'demo', appUrl: 'https://izisuivis.com' },
} satisfies TemplateEntry
