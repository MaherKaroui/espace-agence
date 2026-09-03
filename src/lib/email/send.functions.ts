import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

/**
 * Authenticated app-email send.
 * Non-staff callers may only trigger emails addressed to themselves or to a
 * recipient fixed by the template (admin notification templates).
 */
export const sendAppEmailFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        templateName: z.string().min(1),
        recipientEmail: z.string().email().optional(),
        idempotencyKey: z.string().optional(),
        templateData: z.record(z.string(), z.any()).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context
    const { sendAppEmail, resolveAppEmailRecipient } = await import('./send.server')

    const { data: callerRoles } = await supabase.from('user_roles').select('role').eq('user_id', userId)
    const callerIsStaff = (callerRoles ?? []).some((r: any) =>
      ['admin', 'direction', 'manager', 'consultant'].includes(r.role),
    )

    const { recipient, fixed } = await resolveAppEmailRecipient(data.templateName, data.recipientEmail)

    if (!callerIsStaff) {
      const callerEmail = ((claims as any)?.email ?? '').toLowerCase() || null
      const selfRecipient = Boolean(recipient && callerEmail && recipient.toLowerCase() === callerEmail)
      if (!fixed && !selfRecipient) {
        console.warn('[email] blocked unauthorized recipient', { templateName: data.templateName })
        return { success: false, reason: 'forbidden' as const }
      }
    }

    const result = await sendAppEmail({
      templateName: data.templateName,
      recipientEmail: data.recipientEmail ?? null,
      idempotencyKey: data.idempotencyKey,
      templateData: data.templateData,
    })
    return result
  })
