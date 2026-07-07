import type { ComponentType } from 'react'
import { template as adminNewDossier } from './admin-new-dossier'
import { template as adminNewRdv } from './admin-new-rdv'
import { template as adminNewClient } from './admin-new-client'
import { template as welcomeClient } from './welcome-client'

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
}
