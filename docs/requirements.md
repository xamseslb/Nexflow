# Kravsporing – kundespesifikasjon, 14 sider

Status betyr kode levert i første implementering, ikke produksjonsgodkjent funksjon.
PDF-ens Java/Spring-anbefaling er erstattet av prosjektets obligatoriske stack.

| Krav | Side | Status / gjenstående |
|---|---|---|
| Flere partnere og prosjektisolasjon | 1–4, 8–9 | Modell, API og RLS skrevet; Supabase-verifikasjon gjenstår |
| Mobil-først PWA og hjemskjerm | 1–2, 8, 12 | React-PWA og responsivt UI; ekte iPhone/Android-prøving gjenstår |
| Supabase-innlogging og prosjektroller | 8, 11 | JWT-validering og medlemskap; trenger prosjektkonfigurasjon |
| Dagens prioriterte ringeliste og leadkort | 2, 11 | Implementert med søk, statuser og leadkort |
| Samtaleutfall, tilbakekalling | 2, 11 | Implementert; møte/salg-utfall erstatter ikke egne forretningsposter |
| Selgerflytting og historikk | 3, 9 | Transaksjonelt API med frigjøring og audit; team-UI og «følger med»-regel gjenstår |
| CSV/Excel og Brreg-filter | 3, 10–11 | Validert batchimport-API; filopplasting, parser og Brreg-søk gjenstår |
| Enhetsregister-berikelse | 10 | Arbeider, retries og kontrakttest skrevet |
| Regnskapstall og AI-samtalegrunnlag | 10 | Gjenstår; demooppsummeringer er tydelig fiktive |
| Ingen privatpersonberikelse eller katalogskraping | 4, 10 | B2B-begrensning i arbeider og RLS |
| B2C-registerkontroll ved import og månedlig | 3, 9–10 | Sjekkmodell og ferskhetsregel; leverandør og planlegging gjenstår |
| Partnerspesifikt samtykke og bevis | 3, 9 | Scope, gyldighet og tilbakekalling i modell/regler; innhentingsflyt gjenstår |
| Skriftlig bekreftelse og angrefrist | 3, 6, 12 | B2C-godkjenning sperres uten aksept; utsending, akseptbevis og fristberegning gjenstår |
| Innsyn, sletting, oppbevaring og DPA | 4 | DPA-felt finnes; full eksport/slettejobb/retensjon gjenstår |
| High-ticket-grense og salgstype | 5 | Gjenstår i prosjektoppsett og automatisk ruting |
| Kvalifisering og booking | 6 | Fast grunnskjema, closer-valg, booking og kollisjonsvern; konfigurerbare skjemaer gjenstår |
| .ics, SMS/e-post og møteutfall | 6 | Gjenstår; UI opplyser at utsending ikke er aktiv |
| Møtehonorar utløst av valgt utfall | 6–7 | Gjenstår som egen opptjeningshendelse |
| Produktregler og låst salgsfordeling | 6–7 | Produktpris, prosentregler, snapshot og eksakt ørefordeling implementert |
| Fastlønn/timer, fast per salg, trinnbonus, løpende provisjon | 7 | Gjenstår; ikke fjernet fra omfanget |
| Kvitteringer og flere godkjennere | 4, 9 | Salgsgodkjenning skrevet; privat filopplasting og flertrinnsgodkjenning gjenstår |
| Clawback og periodiske utbetalinger | 6–7 | Gjenstår; ingen utbetalingsendpoint er aktiv |
| Fast partneravgift | 4 | Gjenstår i avtale-/oppgjørsmodul |
| Resultater, egen opptjening og månedlig CSV | 3, 6 | Grunnoversikt og salgs-CSV; full periode-/rollespesifikk rapportering gjenstår |
| Generelle webhooks og idempotent partnersynk | 10–11 | Gjenstår; salgsregistrering har idempotens |
| Partner-CRM, betalt telefonkilde | 10–11 | Fase 2 beholdt |
| Google/Outlook, regnskap, avansert statistikk | 6, 11 | Fase 2 beholdt |
| Manus, innvendinger og kalkulator | 2, 11 | Fase 2 beholdt |
| Selvbetjent onboarding, nivå/opplåsing, flere adaptere | 11 | Fase 3 beholdt |
| Java-dashboard-integrasjon | 7, 12–13 | Venter på eksisterende system; ingen endringer utført |

## Akseptkriterier som skal dokumenteres før MVP-godkjenning

- 2–3 selgere, to prosjekter og en hel arbeidsdag kun på mobil, uten Excel ved siden av.
- Neste lead til ringing under 10 sekunder; utfall maksimalt to trykk.
- Selgerflytting under 15 sekunder med riktig leadregel.
- Samtidige forespørsler kan aldri reservere samme lead for to selgere.
- Reservert B2C-kontakt uten gyldig samtykke kan ikke ringes; forklaring vises.
- Partnerens forsøk på et annet prosjekt gir HTTP 403.
- Nytt bedriftslead ferdig beriket innen ett minutt under avtalt belastning.
- B2C må ha skriftlig aksept før godkjenning og utløpt angrefrist før utbetalingsklar.
- Fordelingslinjer summerer nøyaktig til brutto eks. mva., i øre.
- Installerbar og prøvd på faktisk iPhone og Android.

Ingen avhengighet av eksterne leverandører skal erstattes med en skjult «suksess»-stub.
