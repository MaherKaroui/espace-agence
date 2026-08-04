import { notifyEmail } from './notify'
import { getGroupRecipients } from '@/lib/group-notify.functions'

type Kind = 'client' | 'internal'

function linkFor(kind: Kind, conversationId: string) {
  return kind === 'client'
    ? `/messages/groupes/${conversationId}`
    : `/admin/internal-messages/${conversationId}`
}

/** Prévenir par e-mail les membres qui viennent d'être ajoutés à un groupe. */
export async function notifyGroupMembersAdded(
  kind: Kind,
  conversationId: string,
  userIds: string[],
  groupTitreFallback?: string,
) {
  try {
    if (!userIds.length) return
    const info = await getGroupRecipients({ data: { kind, conversationId, userIds } })
    if (!info?.emails?.length) return
    await Promise.allSettled(
      info.emails.map((email) =>
        notifyEmail({
          templateName: 'group-invitation',
          recipientEmail: email,
          idempotencyKey: `group-invite-${conversationId}-${email}`,
          templateData: {
            groupTitre: info.titre ?? groupTitreFallback,
            invitedBy: info.senderName ?? undefined,
            link: linkFor(kind, conversationId),
          },
        }),
      ),
    )
  } catch {
    /* silencieux */
  }
}

/** Prévenir par e-mail les autres membres d'un nouveau message de groupe (throttle 10 min). */
export async function notifyGroupNewMessage(
  kind: Kind,
  conversationId: string,
  extrait?: string,
) {
  try {
    const info = await getGroupRecipients({ data: { kind, conversationId } })
    if (!info?.emails?.length) return
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000))
    await Promise.allSettled(
      info.emails.map((email) =>
        notifyEmail({
          templateName: 'group-nouveau-message',
          recipientEmail: email,
          idempotencyKey: `group-msg-${conversationId}-${email}-${bucket}`,
          templateData: {
            groupTitre: info.titre ?? undefined,
            senderName: info.senderName ?? undefined,
            extrait: extrait?.slice(0, 140),
            link: linkFor(kind, conversationId),
          },
        }),
      ),
    )
  } catch {
    /* silencieux */
  }
}
