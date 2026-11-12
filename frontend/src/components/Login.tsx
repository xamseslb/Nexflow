import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/api'

type Props = {
  configured: boolean
  restoring: boolean
  busy: boolean
  error: string
  onLogin: (email: string, password: string) => Promise<void>
  onDemo: () => void
}

export function Login({ configured, restoring, busy, error, onLogin, onDemo }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [reset, setReset] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMessage, setResetMessage] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (reset) {
      if (!supabase || resetBusy) return
      setResetBusy(true); setResetMessage('')
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/?auth=password` })
        setResetMessage(error ? 'Kunne ikke sende lenken nå. Vent litt og prøv igjen.' : 'Hvis adressen har en konto, får du en e-post med en lenke. Sjekk også søppelpost.')
      } catch { setResetMessage('Kunne ikke koble til. Prøv igjen.') }
      finally { setResetBusy(false) }
      return
    }
    await onLogin(email.trim(), password)
  }
  return <div className="auth-page">
    <header className="auth-header">
      <a className="brand" href="/" aria-label="Nexflow – hjem"><span className="brand-icon">n</span>Nexflow<span className="brand-sub">CRM</span></a>
      <span className="auth-header-note">Partnerhubens arbeidsflate</span>
    </header>
    <main className="auth-layout auth-layout-login">
      <section className="auth-form-panel" aria-labelledby="login-title">
        <div className="auth-form-wrap">
          <div className="login-heading"><span className="login-accent" aria-hidden="true" /><div><h1 id="login-title">{reset ? 'Glemt passord' : 'Logg inn'}</h1><p className="auth-intro">{reset ? 'Vi sender deg en lenke for å velge et nytt passord.' : 'Bruk kontoen du har fått av administratoren.'}</p></div></div>
          <form className="form-stack auth-form" onSubmit={submit} aria-busy={busy || restoring || resetBusy}>
            <label htmlFor="login-email">E-postadresse<input id="login-email" type="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="navn@bedrift.no" disabled={busy || restoring} /></label>
            {!reset && <label htmlFor="login-password">Passord<span className="password-field"><input id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} onKeyUp={e => setCapsLock(e.getModifierState('CapsLock'))} onBlur={() => setCapsLock(false)} aria-describedby={capsLock ? 'caps-lock' : undefined} disabled={busy || restoring} /><button type="button" aria-label={visible ? 'Skjul passord' : 'Vis passord'} aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>}
            {capsLock && <p id="caps-lock" className="auth-hint" role="status">Caps Lock er på.</p>}
            {!reset && error && <div className="auth-error" role="alert">{error}</div>}
            {resetMessage && <p role="status">{resetMessage}</p>}
            <Button type="submit" disabled={busy || restoring || resetBusy || !configured} className="auth-submit">{busy || restoring || resetBusy ? <><Loader2 className="animate-spin" />{restoring ? 'Henter innlogging…' : 'Vennligst vent…'}</> : <>{reset ? 'Send passordlenke' : 'Logg inn'}<ArrowRight size={17} /></>}</Button>
          </form>
          {configured && <Button variant="ghost" disabled={busy || restoring || resetBusy} onClick={() => { setReset(v => !v); setResetMessage(''); setPassword('') }}>{reset ? 'Tilbake til innlogging' : 'Glemt passord?'}</Button>}
          {!configured && <div className="auth-config"><LockKeyhole size={16} /><p>Innlogging er ikke koblet til ennå. Du kan utforske arbeidsflaten med fiktive data nedenfor.</p></div>}
          <p className="auth-access">Trenger du tilgang? Kontakt administratoren i teamet ditt.</p>
          <div className="auth-demo"><div className="auth-divider"><span>eller</span></div><Button variant="outline" onClick={onDemo} disabled={busy || restoring}>Åpne demonstrasjon</Button><small>Demonstrasjonen bruker fiktive data.</small></div>
        </div>
      </section>
    </main>
    <footer className="auth-footer"><span>Nexflow · Partnerhuben</span><span><LockKeyhole size={13} />Prosjektbasert tilgang</span></footer>
  </div>
}
