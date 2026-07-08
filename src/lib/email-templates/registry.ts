import type { ComponentType } from 'react'
import { template as adminNewDossier } from './admin-new-dossier'
import { template as adminNewRdv } from './admin-new-rdv'
import { template as adminNewClient } from './admin-new-client'
import { template as welcomeClient } from './welcome-client'
import { template as clientDossierCree } from './client-dossier-cree'
import { template as clientDossierStatut } from './client-dossier-statut'
import { template as clientDocumentDemande } from './client-document-demande'
import { template as clientDocumentValide } from './client-document-valide'
import { template as clientDocumentRefuse } from './client-document-refuse'
import { template as clientDossierTermine } from './client-dossier-termine'
import { template as clientDossierAttente } from './client-dossier-attente'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'admin-new-dossier': adminNewDossier,
  'admin-new-rdv': adminNewRdv,
  'admin-new-client': adminNewClient,
  'welcome-client': welcomeClient,
  'client-dossier-cree': clientDossierCree,
  'client-dossier-statut': clientDossierStatut,
  'client-document-demande': clientDocumentDemande,
  'client-document-valide': clientDocumentValide,
  'client-document-refuse': clientDocumentRefuse,
  'client-dossier-termine': clientDossierTermine,
  'client-dossier-attente': clientDossierAttente,
}
