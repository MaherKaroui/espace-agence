import { notifyGroupFn } from '@/lib/group-notify.functions'

type Kind = 'client' | 'internal'

/** Prévenir par e-mail les membres qui viennent d'être ajoutés à un groupe. */
export async function notifyGroupMembersAdded(
  kind: Kind,
  conversationId: string,
  userIds: string[],
  groupTitreFallback?: string,
) {
  try {
    if (!userIds.length) return
    await notifyGroupFn({ data: { event: 'members_added', kind, conversationId, userIds, groupTitreFallback } })
  } catch (e) {
    console.warn('[notify-group]', e)
  }
}

/** Prévenir par e-mail les autres membres d'un nouveau message de groupe (throttle 10 min). */
export async function notifyGroupNewMessage(
  kind: Kind,
  conversationId: string,
  extrait?: string,
) {
  try {
    await notifyGroupFn({ data: { event: 'new_message', kind, conversationId, extrait } })
  } catch (e) {
    console.warn('[notify-group]', e)
  }
}
