import type { ComponentType } from 'react'
import { template as adminNewDossier } from './admin-new-dossier'
import { template as adminNewRdv } from './admin-new-rdv'
import { template as adminNewClient } from './admin-new-client'
import { template as welcomeClient } from './welcome-client'
import { template as clientDossierCree } from './client-dossier-cree'
import { template as clientDossierStatut } from './client-dossier-statut'
import { template as clientDocumentDemande } from './client-document-demande'
import { template as clientDossierTermine } from './client-dossier-termine'
import { template as clientDossierAttente } from './client-dossier-attente'
import { template as relanceClient } from './relance-client'
import { template as clientNouveauMessage } from './client-nouveau-message'
import { template as teamNouveauDossier } from './team-nouveau-dossier'
import { template as teamDocumentDepose } from './team-document-depose'
import { template as teamClientMessage } from './team-client-message'
import { template as clientDocumentRappel } from './client-document-rappel'
import { template as clientDossierInactif } from './client-dossier-inactif'
import { template as clientRdvRappel } from './client-rdv-rappel'
import { template as groupInvitation } from './group-invitation'
import { template as groupNouveauMessage } from './group-nouveau-message'
import { template as rapportActivite } from './rapport-activite'
import { template as supervisionRapport } from './supervision-rapport'
import { template as supervisionAlerte } from './supervision-alerte'

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
  'client-dossier-termine': clientDossierTermine,
  'client-dossier-attente': clientDossierAttente,
  'relance-client': relanceClient,
  'client-nouveau-message': clientNouveauMessage,
  'team-nouveau-dossier': teamNouveauDossier,
  'team-document-depose': teamDocumentDepose,
  'team-client-message': teamClientMessage,
  'client-document-rappel': clientDocumentRappel,
  'client-dossier-inactif': clientDossierInactif,
  'client-rdv-rappel': clientRdvRappel,
  'group-invitation': groupInvitation,
  'group-nouveau-message': groupNouveauMessage,
  'rapport-activite': rapportActivite,
  'supervision-rapport': supervisionRapport,
  'supervision-alerte': supervisionAlerte,
}
