import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, MailCheck, MailX, MailMinus } from 'lucide-react'

export const Route = createFileRoute('/unsubscribe')({
  head: () => ({ meta: [{ title: 'Désabonnement — IZI Business' }] }),
  component: UnsubscribePage,
})

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'already' }
  | { kind: 'confirm' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

function UnsubscribePage() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : null

  useEffect(() => {
    if (!token) { setState({ kind: 'invalid' }); return }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) return setState({ kind: 'invalid' })
        const body = await r.json()
        if (body.valid) setState({ kind: 'confirm' })
        else if (body.reason === 'already_unsubscribed') setState({ kind: 'already' })
        else setState({ kind: 'invalid' })
      })
      .catch(() => setState({ kind: 'error', message: 'Impossible de vérifier le lien.' }))
  }, [token])

  const confirm = async () => {
    if (!token) return
    setState({ kind: 'submitting' })
    try {
      const r = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = await r.json()
      if (body.success) setState({ kind: 'success' })
      else if (body.reason === 'already_unsubscribed') setState({ kind: 'already' })
      else setState({ kind: 'error', message: body.error || 'Erreur inattendue.' })
    } catch (e: any) {
      setState({ kind: 'error', message: e?.message || 'Erreur réseau.' })
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        {state.kind === 'loading' && <><Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" /><p>Vérification…</p></>}
        {state.kind === 'invalid' && <><MailX className="h-10 w-10 mx-auto text-destructive" /><h1 className="font-display text-xl">Lien invalide</h1><p className="text-sm text-muted-foreground">Ce lien de désabonnement est invalide ou a expiré.</p></>}
        {state.kind === 'already' && <><MailMinus className="h-10 w-10 mx-auto text-muted-foreground" /><h1 className="font-display text-xl">Déjà désabonné</h1><p className="text-sm text-muted-foreground">Cette adresse est déjà désabonnée de nos e-mails.</p></>}
        {state.kind === 'confirm' && <>
          <MailMinus className="h-10 w-10 mx-auto text-primary" />
          <h1 className="font-display text-xl">Confirmer le désabonnement</h1>
          <p className="text-sm text-muted-foreground">Vous ne recevrez plus d'e-mails de la part d'IZI Business.</p>
          <Button onClick={confirm} className="w-full">Me désabonner</Button>
        </>}
        {state.kind === 'submitting' && <><Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" /><p>Traitement…</p></>}
        {state.kind === 'success' && <><MailCheck className="h-10 w-10 mx-auto text-emerald-500" /><h1 className="font-display text-xl">Désabonnement confirmé</h1><p className="text-sm text-muted-foreground">Vous ne recevrez plus nos e-mails.</p></>}
        {state.kind === 'error' && <><MailX className="h-10 w-10 mx-auto text-destructive" /><h1 className="font-display text-xl">Erreur</h1><p className="text-sm text-muted-foreground">{state.message}</p></>}
      </Card>
    </div>
  )
}
