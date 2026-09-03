import { APP_URL } from '@/lib/app-url'
import { sendAppEmailFn } from './send.functions'

export interface SendEmailArgs {
  templateName: string
  recipientEmail?: string
  idempotencyKey?: string
  templateData?: Record<string, any>
}

/**
 * Fire-and-forget app email send. Errors are logged but never thrown
 * so they don't disrupt the user flow.
 */
export async function sendTransactionalEmail(args: SendEmailArgs): Promise<boolean> {
  try {
    const result = await sendAppEmailFn({
      data: {
        templateName: args.templateName,
        recipientEmail: args.recipientEmail,
        idempotencyKey: args.idempotencyKey,
        templateData: { ...(args.templateData || {}), appUrl: APP_URL },
      },
    })
    return Boolean((result as any)?.success)
  } catch (e) {
    console.warn('sendTransactionalEmail error', e)
    return false
  }
}
