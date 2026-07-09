import { supabase } from '@/integrations/supabase/client'
import { APP_URL } from '@/lib/app-url'

export interface SendEmailArgs {
  templateName: string
  recipientEmail?: string
  idempotencyKey?: string
  templateData?: Record<string, any>
}

/**
 * Fire-and-forget transactional email send. Errors are logged but never thrown
 * so they don't disrupt the user flow.
 */
export async function sendTransactionalEmail(args: SendEmailArgs): Promise<boolean> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) return false
    const res = await fetch('/lovable/email/transactional/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...args,
        templateData: { ...(args.templateData || {}), appUrl: APP_URL },
      }),
    })
    if (!res.ok) {
      console.warn('sendTransactionalEmail failed', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (e) {
    console.warn('sendTransactionalEmail error', e)
    return false
  }
}
