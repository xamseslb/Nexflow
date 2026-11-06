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
| Selgerflytting og historikk | 3, 9 | Leder kan flytte selger mellom prosjekter. Tildelt kontakt deler historikk med ny ansvarlig. Andre overføringsregler avklares med kunden. |
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
| .ics, SMS/e-post og møteutfall | 6 | Kalenderfil og fem møteutfall er levert. Automatisk SMS/e-post gjenstår. |
| Møtehonorar utløst av valgt utfall | 6–7 | Gjenstår som egen opptjeningshendelse |
| Produktregler og låst salgsfordeling | 6–7 | Produktpris, prosentregler, snapshot og eksakt ørefordeling implementert |
| Fastlønn/timer, fast per salg, trinnbonus, løpende provisjon | 7 | Gjenstår; ikke fjernet fra omfanget |
| Kvitteringer og flere godkjennere | 4, 9 | Salgsgodkjenning og private salgsvedlegg er levert i kode. Test på kundens Storage og flertrinnsgodkjenning gjenstår. |
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

## Tillegg fra kundemøtet – november 2026

| Kundeønske | Levert i Nexflow | Åpent før pilot eller videre utbygging |
|---|---|---|
| 1. Datainnhenting og søk | Kundeoversikten søker server-side i bedrift, kontaktperson, telefon og organisasjonsnummer innenfor brukerens tilgang. Brreg-arbeideren beriker B2B-leads. | [Proff tilbyr et API](https://apidocs.proff.no/guide/). Avtal felter, bruksrett og tilgang før tilkobling. |
| 2. Ringelister | Lederen oppretter navngitte Hot-, Cold- og Winback-lister, tildeler én ansvarlig per liste og flytter leads. Åpning reserverer neste ringbare kontakt. Etter lagret utfall hentes neste automatisk. Selgeren kan gå videre til et eget møte eller salg. | Mobilpilot med faktiske selgere. Automatisk oppringing venter på telefonileverandør. |
| 3. Prosjekter | Eget arbeidsområde med kunder, lister, resultater og en konfigurerbar prosjekttype. B2B/B2C angis separat. | Prosjektspesifikke eksterne verktøy bestemmes for piloten. |
| 4. Roller og oppgaver | Administrator kan gi og endre prosjekttilgang for eksisterende Supabase-brukere. Ledere fordeler lister og oppgaver, ser team og registrerte faglige styrker samt flytter selgere mellom prosjekter de leder. | Første administrator, testbrukere og prosjekt opprettes i Supabase. Invitasjoner og full selvbetjent onboarding er egne arbeidsflyter. |
| 5. Kundeoppfølging | **Kunder** samler kontaktinformasjon, siste samtaler, fremdrift, møter, åpne oppgaver og salg. Den nye ansvarlige får tidligere notater på tildelte leads. | Gjennomgå innsyn og oppbevaring sammen med kunden før reelle personopplysninger brukes. |
| 6. Telefoni og kvalitet | Anrop åpnes manuelt etter serverkontroll. Selgeren registrerer utfall, behov og neste steg i et notat og kan flagge en samtale. Lederen ser, vurderer og lukker saken. | Ingen telefonileverandør valgt. Samtaleopptak med start/stopp, automatisk notering og automatisk flagging krever beslutninger om arbeidsflyt, tilgang, informasjon og lagring. |
| 7. Analyse | Prosjektrapport med tidsserier. Porteføljevisning over prosjekter brukeren leder, prosjekttype, marked og team. Salg kan åpnes for detaljer, også på mobil. | Kunden må godkjenne nøkkeltall og konserninndeling. Rapporter følger eksplisitt prosjektmedlemskap. |
| 8. Salg og kvitteringer | Daterte salg med kunde, produkt, beløp, fordeling og godkjenningsstatus. Private vedlegg per salg via Supabase Storage med medlems- og eierskapskontroll. | Verifiser opplasting og nedlasting mot den faktiske Storage-tjenesten. Flertrinnsgodkjenning og flere av lønnsreglene i originalspesifikasjonen gjenstår. |
| 9. Integrasjoner | Brreg-arbeideren behandler berikelse i bakgrunnen. Møter kan lastes ned som kalenderfil. | Kunden har ennå ikke valgt telefonileverandør eller eksternt CRM. Synkretning, felt, avtaler og tilganger må avklares. SMS- og e-postutsending gjenstår. |
| 10. Salgsprosess | Kundeprofilen viser åtte salgstrinn. Tildeling, kontakt og oppfølging får betydning for fremdriften. Bare registrert salg gir siste trinn. Closer kan føre utfall etter gjennomført møte. | Avstem overgangene med kundens faktiske salgsprosess i piloten. |
| 11. Videre avklaring | Faglige styrker legges inn manuelt, kvalitetskontroll starter med manuell flagging. | Avklar kriterier og eventuell automatisering. |

### Prøv ringeflyten

1. Velg **Åpne demonstrasjon → Ringekøer**. Åpne en Hot-liste for å prøve selgerens arbeidsflate, eller velg **Ny ringeliste** for å prøve lederens.
2. Under administrasjon av listen velger lederen selger og kontakter. Hver kontakt kan bare være i én liste om gangen. En aktiv reservasjon hindrer flytting mens selgeren arbeider.
3. Åpne listen. Les kontaktinformasjon og forrige notat, simuler anropet og velg utfall. En fremtidig tilbakekalling blir tilgjengelig når tidspunktet er nådd. Et sperret lead kan heller ikke ringes fra Winback.
4. Lagre. Neste tilgjengelige kontakt vises. Ved møte eller salg kan selgeren fullføre registreringen for forrige kontakt og deretter fortsette i køen.

RLS- og samtidighetstester bruker en egen PostgreSQL-instans med testidentiteter. Kundens akseptprøve omfatter fortsatt to prosjekter, faktiske brukerroller og en arbeidsdag på mobil.
