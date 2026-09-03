import { createClient } from '@supabase/supabase-js'
import { sendTemplateEmail } from '@/lib/email-templates/send-email'
import { TEMPLATES } from '@/lib/email-templates/registry'

/**
 * Server-only app-email sender.
 * Sends through Lovable's managed email API and keeps the app's own
 * behaviour: admin-controlled per-template toggle, admin_email routing for
 * `admin-*` templates, and the email_send_log history.
 */

export interface SendAppEmailArgs {
  templateName: string
  recipientEmail?: string | null
  idempotencyKey?: string
  templateData?: Record<string, any>
}

export type SendAppEmailResult =
  | { success: true }
  | { success: false; reason: 'template_disabled' | 'template_not_found' | 'no_recipient' | 'recipient_suppressed' | 'send_failed'; error?: string }

function redactEmail(email: string | null | undefined): string {
  if (!email) return '***'
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart[0]}***@${domain}`
}

function adminClient() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase server configuration')
  }
  return createClient(supabaseUrl, supabaseServiceKey)
}

async function logSend(
  supabase: ReturnType<typeof adminClient>,
  row: {
    template_name: string
    recipient_email: string
    status: 'sent' | 'suppressed' | 'failed'
    error_message?: string | null
  },
) {
  const { error } = await supabase.from('email_send_log').insert({
    message_id: null,
    template_name: row.template_name,
    recipient_email: row.recipient_email,
    status: row.status,
    error_message: row.error_message ?? null,
  })
  if (error) {
    console.error('[email] failed to write email_send_log', {
      code: error.code,
      message: error.message,
    })
  }
}

/**
 * Resolve the effective recipient for a template (admin routing + fixed `to`).
 * Returns null when no recipient can be determined.
 */
export async function resolveAppEmailRecipient(
  templateName: string,
  recipientEmail?: string | null,
): Promise<{ recipient: string | null; disabled: boolean; fixed: boolean }> {
  const supabase = adminClient()
  const template = TEMPLATES[templateName]
  const { data: settings } = await supabase
    .from('email_settings')
    .select('disabled_templates, admin_email')
    .eq('id', 1)
    .maybeSingle()

  const disabled = Boolean((settings as any)?.disabled_templates?.includes(templateName))
  const isAdminTemplate = templateName.startsWith('admin-')
  const adminOverride = isAdminTemplate && (settings as any)?.admin_email ? (settings as any).admin_email : null
  const recipient = adminOverride || template?.to || recipientEmail || null
  return { recipient, disabled, fixed: Boolean(adminOverride || template?.to) }
}

/** Send one app email to one recipient. Never throws. */
export async function sendAppEmail(args: SendAppEmailArgs): Promise<SendAppEmailResult> {
  const { templateName, templateData = {}, idempotencyKey } = args

  let supabase: ReturnType<typeof adminClient>
  try {
    supabase = adminClient()
  } catch (e) {
    console.error('[email] configuration error', e)
    return { success: false, reason: 'send_failed', error: 'Server configuration error' }
  }

  const template = TEMPLATES[templateName]
  if (!template) {
    console.error('[email] template not found', { templateName })
    return { success: false, reason: 'template_not_found' }
  }

  const { recipient, disabled } = await resolveAppEmailRecipient(templateName, args.recipientEmail)

  if (disabled) {
    await logSend(supabase, {
      template_name: templateName,
      recipient_email: recipient || args.recipientEmail || 'unknown',
      status: 'suppressed',
      error_message: 'Template disabled by admin',
    })
    return { success: false, reason: 'template_disabled' }
  }

  if (!recipient) {
    return { success: false, reason: 'no_recipient' }
  }

  try {
    const result = await sendTemplateEmail(templateName, recipient, {
      templateData,
      idempotencyKey,
    })
    if (!result.sent) {
      await logSend(supabase, {
        template_name: templateName,
        recipient_email: recipient,
        status: 'suppressed',
      })
      console.log('[email] recipient suppressed', {
        templateName,
        recipient_redacted: redactEmail(recipient),
      })
      return { success: false, reason: 'recipient_suppressed' }
    }
    await logSend(supabase, {
      template_name: templateName,
      recipient_email: recipient,
      status: 'sent',
    })
    return { success: true }
  } catch (e: any) {
    const message = String(e?.message ?? e).slice(0, 500)
    await logSend(supabase, {
      template_name: templateName,
      recipient_email: recipient,
      status: 'failed',
      error_message: message,
    })
    console.error('[email] send failed', {
      templateName,
      recipient_redacted: redactEmail(recipient),
      message,
    })
    return { success: false, reason: 'send_failed', error: message }
  }
}
