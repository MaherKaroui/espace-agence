import React from 'react'
import { Body, Container, Head, Heading, Html, Preview, Text, Section, Button, Hr } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { styles as s } from './_shared'

interface Problem { titre?: string; priorite?: string; cause?: string; correction?: string }
interface Suggestion { titre?: string; priorite?: string; impact?: string; action?: string }

interface Props {
  dateFr?: string
  score?: number
  scoreVeille?: number | null
  uptime?: number
  erreursCritiques?: number
  erreursMajeures?: number
  problems?: Problem[]
  anomalies?: { label?: string; count?: number }[]
  suggestions?: Suggestion[]
  diagnostic?: string
  appUrl?: string
}

const Email = ({
  dateFr, score = 0, scoreVeille, uptime = 0, erreursCritiques = 0, erreursMajeures = 0,
  problems = [], anomalies = [], suggestions = [], diagnostic, appUrl,
}: Props) => {
  const delta = typeof scoreVeille === 'number' ? score - scoreVeille : null
  return (
    <Html lang="fr">
      <Head />
      <Preview>{`Supervision izisuivis — santé ${score}/100`}</Preview>
      <Body style={s.main}>
        <Container style={s.container}>
          <Heading style={s.h1}>Supervision izisuivis</Heading>
          <Text style={s.text}>Rapport du {dateFr || ''}</Text>

          <Section style={s.card}>
            <Text style={s.label}>Note de santé</Text>
            <Text style={{ ...s.value, fontSize: '28px' }}>
              {score}/100{delta !== null ? ` (${delta >= 0 ? '+' : ''}${delta} vs veille)` : ''}
            </Text>
            <Text style={s.text}>Disponibilité du site sur 24h : <b>{uptime}%</b></Text>
            <Text style={s.text}>Erreurs critiques : <b>{erreursCritiques}</b> — majeures : <b>{erreursMajeures}</b></Text>
          </Section>

          {diagnostic ? (
            <Section style={s.card}>
              <Text style={s.label}>Diagnostic</Text>
              <Text style={s.text}>{diagnostic}</Text>
            </Section>
          ) : null}

          {problems.length > 0 ? (
            <Section style={s.card}>
              <Text style={s.label}>Problèmes prioritaires</Text>
              {problems.slice(0, 5).map((p, i) => (
                <Text key={i} style={s.text}>
                  • [{p.priorite || 'mineur'}] <b>{p.titre}</b>
                  {p.correction ? ` — ${p.correction}` : ''}
                </Text>
              ))}
            </Section>
          ) : null}

          {anomalies.length > 0 ? (
            <Section style={s.card}>
              <Text style={s.label}>Anomalies de données</Text>
              {anomalies.map((a, i) => (
                <Text key={i} style={s.text}>• {a.label} : <b>{a.count ?? 0}</b></Text>
              ))}
            </Section>
          ) : null}

          {suggestions.length > 0 ? (
            <Section style={s.card}>
              <Text style={s.label}>Top 3 des améliorations</Text>
              {suggestions.slice(0, 3).map((g, i) => (
                <Text key={i} style={s.text}>
                  {i + 1}. <b>{g.titre}</b>{g.impact ? ` — impact : ${g.impact}` : ''}
                </Text>
              ))}
            </Section>
          ) : null}

          {appUrl && (
            <Section style={{ textAlign: 'center', marginTop: 24 }}>
              <Button href={`${appUrl}/admin/agent-ia`} style={s.button}>Ouvrir l'Agent IA</Button>
            </Section>
          )}
          <Hr />
          <Text style={s.text}>IZISuivis — supervision automatique</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: Email,
  subject: (d) => `Supervision izisuivis - ${d?.dateFr ?? ''} - Sante ${d?.score ?? 0}/100`,
  displayName: 'Supervision — rapport quotidien',
  previewData: {
    dateFr: '19/08/2026', score: 82, scoreVeille: 75, uptime: 99.8,
    erreursCritiques: 1, erreursMajeures: 3,
    diagnostic: "L'application est globalement stable.",
    problems: [{ titre: 'Erreur RLS sur les dossiers', priorite: 'majeur', correction: 'Vérifier la policy' }],
    anomalies: [{ label: 'Tâches sans responsable', count: 4 }],
    suggestions: [{ titre: 'Ajouter un filtre par pôle', impact: 'Gain de temps' }],
  },
}
