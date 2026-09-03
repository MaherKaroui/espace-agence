import { createEmailWebhookHandler } from '@lovable.dev/email-js'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'

type Reason = 'bounce' | 'complaint' | 'unsubscribe'

const SEND_LOG_STATUS: Record<Reason, 'bounced' | 'complained' | 'suppressed'> = {
  bounce: 'bounced',
  complaint: 'complained',
  unsubscribe: 'suppressed',
}

const SEND_LOG_MESSAGE: Record<Reason, string> = {
  bounce: 'Permanent bounce — email address is invalid or rejected',
  complaint: 'Spam complaint — recipient marked email as spam',
  unsubscribe: 'Recipient unsubscribed',
}

function adminClient() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase server configuration')
  }
  return createClient(supabaseUrl, supabaseServiceKey)
}

/** Mirror a terminal delivery outcome into the app's own history tables. */
async function recordOutcome(
  reason: Reason,
  recipient: string,
  messageId: string | null,
  eventId: string,
) {
  const supabase = adminClient()
  const normalizedEmail = recipient.toLowerCase()

  const { error: suppressError } = await supabase
    .from('suppressed_emails')
    .upsert({ email: normalizedEmail, reason, metadata: null }, { onConflict: 'email' })
  if (suppressError) {
    console.error('Failed to upsert suppressed email', {
      code: suppressError.code,
      message: suppressError.message,
      event_id: eventId,
    })
    throw new Error('Failed to write suppression')
  }

  const { error: insertError } = await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: 'system',
    recipient_email: normalizedEmail,
    status: SEND_LOG_STATUS[reason],
    error_message: SEND_LOG_MESSAGE[reason],
    metadata: null,
  })
  if (insertError) {
    console.warn('Failed to insert email_send_log', {
      code: insertError.code,
      message: insertError.message,
      event_id: eventId,
    })
  }

  if (reason === 'unsubscribe') {
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('email', normalizedEmail)
      .is('used_at', null)
    if (tokenError) {
      console.warn('Failed to stamp unsubscribe token', {
        code: tokenError.code,
        message: tokenError.message,
        event_id: eventId,
      })
    }
  }
}

export const Route = createFileRoute("/lovable/email/events")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const apiKey = process.env['LOVABLE_API_KEY']
        if (!apiKey) {
          console.error('Missing required environment variables')
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }
        const handler = createEmailWebhookHandler({
          apiKey,
          on: {
            'email.bounced': async (event) => {
              await recordOutcome(
                'bounce',
                event.data.recipient,
                (event.data as any).message_id ?? null,
                event.event_id,
              )
            },
            'email.complaint': async (event) => {
              await recordOutcome(
                'complaint',
                event.data.recipient,
                (event.data as any).message_id ?? null,
                event.event_id,
              )
            },
            'email.unsubscribed': async (event) => {
              await recordOutcome(
                'unsubscribe',
                event.data.recipient,
                (event.data as any).message_id ?? null,
                event.event_id,
              )
            },
          },
        })
        return handler(request)
      },
    },
  },
})
