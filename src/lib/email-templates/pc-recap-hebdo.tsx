import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr, Link } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Line { titre: string; detail?: string; dossierId?: string }
interface Props {
  prenom?: string
  echeances?: Line[]
  documents?: Line[]
  retards?: Line[]
  appUrl?: string
}

const Block = ({ title, lines, appUrl, empty }: { title: string; lines?: Line[]; appUrl?: string; empty: string }) => (
  <Section style={s.card}>
    <Text style={s.label}>{title} ({lines?.length ?? 0})</Text>
    {lines && lines.length > 0 ? lines.map((l, i) => (
      <Text key={i} style={s.text}>
        {appUrl && l.dossierId ? <Link href={`${appUrl}/pole-certification/${l.dossierId}`}>{l.titre}</Link> : l.titre}
        {l.detail ? ` — ${l.detail}` : ''}
      </Text>
    )) : <Text style={s.text}>{empty}</Text>}
  </Section>
)

const Email = ({ prenom, echeances, documents, retards, appUrl }: Props) => (
  <Html lang="fr">
    <Head />
    <Preview>Votre semaine — Pôle Certification & EDOF</Preview>
    <Body style={s.main}>
      <Container style={s.container}>
        <Heading style={s.h1}>Récapitulatif de la semaine</Heading>
        <Text style={s.text}>Bonjour{prenom ? ` ${prenom}` : ''}, voici ce qui vous attend sur le pôle Certification &amp; EDOF.</Text>
        <Block title="Dossiers en retard" lines={retards} appUrl={appUrl} empty="Aucun dossier en retard." />
        <Block title="Échéances de la semaine" lines={echeances} appUrl={appUrl} empty="Aucune échéance cette semaine." />
        <Block title="Documents qui expirent" lines={documents} appUrl={appUrl} empty="Aucun document n'expire prochainement." />
        {appUrl && (
          <Section style={{ textAlign: 'center', marginTop: 24 }}>
            <Button href={`${appUrl}/pole-certification`} style={s.button}>Ouvrir le tableau de bord</Button>
          </Section>
        )}
        <Hr style={s.hr} />
        <Text style={s.footer}>IZISuivis — récapitulatif automatique du lundi</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'IZISuivis — Votre semaine Certification & EDOF',
  displayName: 'Équipe — Récapitulatif hebdomadaire Certification & EDOF',
  previewData: {
    prenom: 'Nadine',
    retards: [{ titre: 'EDOF — OF Démo', detail: 'Étape 4 en retard de 3 j' }],
    echeances: [{ titre: 'Titre RS — Formateur', detail: 'Étape 3 le 30/10/2026' }],
    documents: [{ titre: 'EDOF — OF Démo', detail: 'Kbis expire le 05/11/2026' }],
  },
} satisfies TemplateEntry
