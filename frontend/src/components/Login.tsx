import { useState, type FormEvent } from 'react'
import { ArrowRight, ArrowUpRight, Check, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  async function submit(event: FormEvent) {
    event.preventDefault()
    await onLogin(email.trim(), password)
  }
  return <div className="auth-page">
    <header className="auth-header">
      <a className="brand" href="/" aria-label="Hub CRM – hjem"><span className="brand-icon">h</span>hub<span className="brand-sub">CRM</span></a>
      <span className="auth-header-note">Partnerhubens arbeidsflate</span>
    </header>
    <main className="auth-layout">
      <section className="auth-form-panel" aria-labelledby="login-title">
        <div className="auth-form-wrap">
          <span className="auth-kicker">DITT ARBEIDSOMRÅDE</span>
          <h1 id="login-title">Velkommen tilbake.</h1>
          <p className="auth-intro">Logg inn for å fortsette der du slapp.</p>
          <form className="form-stack auth-form" onSubmit={submit} aria-busy={busy || restoring}>
            <label htmlFor="login-email">E-postadresse<input id="login-email" type="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="navn@bedrift.no" disabled={busy || restoring} /></label>
            <label htmlFor="login-password">Passord<span className="password-field"><input id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} onKeyUp={e => setCapsLock(e.getModifierState('CapsLock'))} onBlur={() => setCapsLock(false)} aria-describedby={capsLock ? 'caps-lock' : undefined} disabled={busy || restoring} /><button type="button" aria-label={visible ? 'Skjul passord' : 'Vis passord'} aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
            {capsLock && <p id="caps-lock" className="auth-hint" role="status">Caps Lock er på.</p>}
            {error && <div className="auth-error" role="alert">{error}</div>}
            <Button type="submit" disabled={busy || restoring || !configured} className="auth-submit">{busy || restoring ? <><Loader2 className="animate-spin" />{restoring ? 'Henter innlogging…' : 'Logger inn…'}</> : <>Logg inn<ArrowRight size={17} /></>}</Button>
          </form>
          {!configured && <div className="auth-config"><LockKeyhole size={16} /><p>Innlogging er ikke koblet til ennå. Du kan utforske arbeidsflaten med fiktive data nedenfor.</p></div>}
          <p className="auth-access">Trenger du tilgang eller nytt passord?<br />Kontakt administratoren i teamet ditt.</p>
          <div className="auth-demo"><div><strong>Se hvordan Hub fungerer</strong><p>Utforsk CRM-et uten å logge inn.</p></div><Button variant="outline" onClick={onDemo} disabled={busy || restoring}>Åpne demonstrasjon<ArrowUpRight size={16} /></Button><small>Kun fiktive data. Ingen anrop eller utsendinger.</small></div>
        </div>
      </section>
      <aside className="auth-product" aria-label="Om Hub CRM">
        <div className="auth-product-copy"><span className="auth-kicker">KONTAKT. SAMTALE. NESTE STEG.</span><h2>Mindre administrasjon.<br />Mer tid til kundene.</h2><p>Ringelisten, møtene og salgene samlet i én arbeidsflate. Med riktig tilgang for hvert prosjekt.</p></div>
        <div className="product-preview" aria-label="Eksempel på ringeliste med fiktive data">
          <div className="preview-top"><span className="preview-mark">h</span><strong>Digitale vekstpakker</strong><span className="preview-label">EKSEMPEL</span></div>
          <div className="preview-heading"><div><small>ARBEIDSOMRÅDE</small><h3>Ringeliste</h3></div><span className="preview-counter">3 kontakter</span></div>
          <div className="preview-columns"><span>BEDRIFT / KONTAKT</span><span>NESTE STEG</span></div>
          {[['FF', 'Fjord & Form', 'Emma Berg · Bergen', 'Ny kontakt'], ['NE', 'Nordlys Elektro', 'Jonas Vik · Tromsø', 'Ring tilbake'], ['LK', 'Løkka Kaffebrenneri', 'Sara Holm · Oslo', 'Møte booket']].map(([initials, company, contact, status], index) => <div className="preview-row" key={company}><span className={`preview-avatar preview-avatar-${index}`}>{initials}</span><div><strong>{company}</strong><small>{contact}</small></div><span className={`preview-status preview-status-${index}`}>{status}</span></div>)}
          <div className="preview-bottom"><Check size={14} />Alt klart for neste samtale<span>01 — 03</span></div>
        </div>
        <div className="auth-product-bottom"><span>01 / Én samlet arbeidsdag</span><span className="preview-pagination" aria-hidden="true"><i /><i /><i /></span></div>
      </aside>
    </main>
    <footer className="auth-footer"><span>Hub CRM · Partnerhuben</span><span><LockKeyhole size={13} />Prosjektbasert tilgang</span></footer>
  </div>
}
