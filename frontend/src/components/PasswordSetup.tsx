import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/api'

export function PasswordSetup({ ready, restoring, onDone }: { ready: boolean; restoring: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!restoring && ready) {
      // Keep the setup screen on reload, without retaining tokens in the URL.
      const url = new URL(window.location.href)
      url.searchParams.set('auth', 'password')
      url.hash = ''
      window.history.replaceState(null, '', url.pathname + url.search)
    }
  }, [ready, restoring])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !supabase || !ready) return
    if (password !== confirm) { setError('Passordene er ikke like.'); return }
    setBusy(true); setError('')
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) { setError('Kunne ikke lagre passordet. Bruk minst 12 tegn, eller be om en ny lenke hvis denne er utløpt.'); return }
      setPassword(''); setConfirm(''); onDone()
    } catch { setError('Kunne ikke koble til. Prøv igjen.') }
    finally { setBusy(false) }
  }
  return <div className="auth-page">
    <header className="auth-header"><a className="brand" href="/" aria-label="Nexflow – hjem"><span className="brand-icon">n</span>Nexflow<span className="brand-sub">CRM</span></a></header>
    <main className="auth-layout auth-layout-login"><section className="auth-form-panel" aria-labelledby="password-title"><div className="auth-form-wrap">
      <div className="login-heading"><span className="login-accent" aria-hidden="true" /><div><h1 id="password-title">Velg passord</h1><p className="auth-intro">Bruk minst 12 tegn. Passordet lagres i din innloggingskonto.</p></div></div>
      {restoring ? <p role="status">Kontrollerer lenken…</p> : ready ? <form className="form-stack auth-form" onSubmit={submit} aria-busy={busy}>
        <label htmlFor="new-password">Nytt passord<input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
        <label htmlFor="confirm-password">Gjenta passord<input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Lagrer…' : 'Lagre passord og fortsett'}</Button>
      </form> : <div><p className="auth-error" role="alert">Lenken er utløpt eller ugyldig. Gå til innlogging og bruk «Glemt passord» for å få en ny.</p><Button onClick={onDone}>Til innlogging</Button></div>}
    </div></section></main>
  </div>
}
