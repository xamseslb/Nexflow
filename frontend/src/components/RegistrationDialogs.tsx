import type { FormEventHandler } from 'react'
import { CalendarDays, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import type { Product } from '@/lib/crmTypes'
import { money } from '@/lib/utils'

export type WorkspaceDialog =
  | 'lead'
  | 'sale'
  | 'meeting'
  | 'help'
  | 'pick-meeting'
  | 'pick-sale'
  | null
type Props = {
  modal: WorkspaceDialog
  demo: boolean
  online: boolean
  busy: boolean
  error: string
  company?: string
  products: Product[]
  closers: { id: string; name: string }[]
  closeLead: () => void
  closeRegistration: () => void
  submitLead: FormEventHandler<HTMLFormElement>
  submitSale: FormEventHandler<HTMLFormElement>
  submitMeeting: FormEventHandler<HTMLFormElement>
}

// The workspace owns reservations and saves. Closing a form can return to the lead
// card or the originating page, depending on where the seller started.
export function RegistrationDialogs({
  modal,
  demo,
  busy,
  online,
  error,
  company,
  products,
  closers,
  closeLead,
  closeRegistration,
  submitLead,
  submitSale,
  submitMeeting,
}: Props) {
  return (
    <>
      <Dialog
        open={modal === 'lead'}
        onOpenChange={(open) => !open && closeLead()}
        title="Nytt lead"
        description={
          demo
            ? 'Bruk kun fiktive opplysninger i demonstrasjonen.'
            : 'Leadet knyttes til det aktive prosjektet.'
        }
      >
        <form className="form-stack" onSubmit={submitLead}>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <label>
            Bedrift / navn
            <input name="company" required maxLength={200} placeholder="Bedrift AS" />
          </label>
          <label>
            Kontaktperson
            <input name="contact" maxLength={200} placeholder="Fornavn Etternavn" />
          </label>
          <div className="form-columns">
            <label>
              Telefon
              <input
                name="phone"
                type="tel"
                required
                pattern="\+[1-9][0-9]{7,14}"
                placeholder="+47…"
              />
            </label>
            <label>
              Type
              <select name="kind">
                <option value="b2b">Bedrift (B2B)</option>
                <option value="b2c">Forbruker (B2C)</option>
              </select>
            </label>
          </div>
          <label>
            Organisasjonsnummer (valgfritt)
            <input
              name="org_number"
              inputMode="numeric"
              pattern="[0-9]{9}"
              placeholder="9 siffer"
            />
          </label>
          <Button disabled={busy || !online}>
            {busy && <Loader2 className="animate-spin" />}Legg til lead
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={modal === 'sale'}
        onOpenChange={(open) => !open && closeRegistration()}
        title="Registrer salg"
        description={`${company || ''} · Fordelingen beregnes fra produktets gjeldende regel.`}
      >
        <form className="form-stack" onSubmit={submitSale}>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <label>
            Produkt
            <select name="product" required>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.price_ore)}
                </option>
              ))}
            </select>
          </label>
          <div className="research-box">
            <p>
              Salget sendes til godkjenning. For B2C kreves også dokumentert skriftlig aksept. Dette
              registrerer ikke en utbetaling.
            </p>
          </div>
          <Button disabled={busy || !online || !products.length}>
            Registrer og send til godkjenning
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={modal === 'meeting'}
        onOpenChange={(open) => !open && closeRegistration()}
        title="Book kvalifiseringsmøte"
        description={`${company || ''} · 30 minutter. Kalenderutsending er foreløpig ikke aktivert.`}
      >
        <form className="form-stack" onSubmit={submitMeeting}>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <label>
            Tidspunkt
            <input name="starts" type="datetime-local" required />
          </label>
          <label>
            Closer
            <select name="closer" required>
              <option value="">Velg closer</option>
              {closers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Behov
            <input
              name="needs"
              required
              maxLength={1000}
              placeholder="Hva ønsker kunden å oppnå?"
            />
          </label>
          <div className="form-columns">
            <label>
              Budsjett
              <input name="budget" required maxLength={200} />
            </label>
            <label>
              Beslutningstaker
              <input name="decision" required maxLength={200} />
            </label>
          </div>
          <label>
            Tidslinje
            <input name="timeline" required maxLength={200} />
          </label>
          <Button disabled={busy || !online}>
            Registrer møte <CalendarDays />
          </Button>
        </form>
      </Dialog>
    </>
  )
}
