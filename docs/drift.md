# Drift av Nexflow

Bruk denne veiledningen ved oppsett av et miljø, migrering eller feilsøking i piloten. For lokal utvikling og tester, se [README](../README.md).

## Supabase og roller

Opprett et eget Supabase-utviklingsprosjekt i valgt EU/EØS-region. Kjør migreringen med
administrativ `MIGRATION_DATABASE_URL`. Den oppretter skjemaene `hub` / `hub_private`
og NOLOGIN-rollene `hub_api` / `hub_worker`. Ikke eksponer disse skjemaene i Data API.

Opprett deretter separate LOGIN-roller med sterke passord via sikker administrativ kanal:

```sql
CREATE ROLE hub_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT hub_api TO hub_runtime;
CREATE ROLE hub_jobs_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT hub_worker TO hub_jobs_runtime;
```

Sett passord sikkert uten å sjekke dem inn. `DATABASE_URL` skal bruke `hub_runtime`,
`WORKER_DATABASE_URL` skal bruke `hub_jobs_runtime`. Bruk Supabase-forbindelsen som
støtter disse rollene (direkte forbindelse eller passende session pooler), med TLS.
Ikke gi runtime-rollene medlemskap i postgres, service_role eller migreringsrollen.

Migreringene oppretter den private bøtten `nexflow-sale-documents` når Supabase Storage er installert. Systemet knytter hver fil til et eksisterende salg og kontrollerer lesing og opplasting mot aktivt medlemskap og selgerrolle. Sett av en test med to brukerøkter for å prøve faktiske filoperasjoner i Supabase.

Opprett brukere via Supabase Auth. Første partner, prosjekt, produkt og medlemskap legges
inn administrativt. Selvbetjent onboarding er fase 3. Medlemskap refererer til `auth.users.id`.
`raw_user_meta_data.display_name` brukes kun som visningsnavn, aldri til autorisasjon.
Test minst to partnere og to prosjekter før ekte data tas inn.

## Lokal drift med Docker

Etter oppsett av utviklingsdatabasen kan du starte API, arbeider og webserver med
`docker compose up --build` fra prosjektroten. Compose leser API- og arbeiderinnstillinger fra
`backend/.env`. Sett `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` i terminalen for frontendbygget.
Webgrensesnittet åpnes på port 8080. Migreringer kjøres separat. Arbeideren i Compose behandler
forfalte oppslag. For å teste søk etter nye bedrifter, bruk batchkommandoen med `--discover` fra README.

## Utrulling på Render og eksisterende Netlify-prosjekt

`render.yaml` klargjør `nexflow-api` og `nexflow-enrichment` i Frankfurt med
Docker og manuell utrulling. Begge bruker betalt, kontinuerlig drift; kontroller
prisen i Render før opprettelse. Filen oppretter ingen database. Supabase-prosjektet
`udkigapetwzmyaqztkzj` og Netlify-prosjektet `gorgeous-concha-82f7a1` beholdes.

Piloten 12. november 2026 bruker i stedet manuelt opprettet **gratis API** på
`https://nexflow-api-cms0.onrender.com`. Betalt aktivering er utsatt av eieren.
Bakgrunnsarbeideren er derfor ikke startet på Render. Den begrensede
databasebrukeren er klargjort, og arbeideren kan kjøres lokalt med
`python -m app.worker --once` for én forfalt jobb. Den alternative GitHub Actions-
timejobben nedenfor kan utføre daglig berikelse uten en betalt Render-arbeider.
API-et alene utfører ikke køjobbene.
Gratis-API-et kan gå i hvile og bruke minst 50 sekunder på første forespørsel.

1. Kjør alle Alembic-migreringene separat med administrativ databaseforbindelse.
2. Opprett de begrensede LOGIN-rollene beskrevet ovenfor. Sett `DATABASE_URL` bare
   på API-tjenesten og `WORKER_DATABASE_URL` bare på arbeideren. Bruk TLS og riktig
   Supabase session pooler dersom verten trenger IPv4. Passord med spesialtegn må URL-kodes.
3. Sett aldri `MIGRATION_DATABASE_URL` på de kjørende Render-tjenestene.
   `APP_ENV=production` stopper oppstart ved manglende TLS, feil innlogging,
   administrativ databaserolle, manglende skjema eller deaktiverte RLS-regler.
4. Verifiser API-helsen, en avvist uautentisert forespørsel og en innlogget økt
   med faktisk prosjektmedlemskap før frontend publiseres.
5. Bygg Netlify med `VITE_DEMO_MODE=false`, Supabase-prosjektets URL og publishable key,
   samt `VITE_API_URL=https://<bekreftet-api-vertsnavn>/api/v1`. Oppdater Supabase Auth
   Site URL til kundelenken. Ikke bruk service-role-nøkkel i frontend.
6. Verifiser to brukere med ulike prosjekttilganger og et B2B-oppslag via arbeideren.
   Kontroller kilde og tidspunkt på kundekortet, og at endringer overlever ny innlogging.

Netlify kan enten bygge fra Git med `netlify.toml` eller motta en lokalt bygget
`frontend/dist`. Ved manuell opplasting må miljøvariablene være satt **før bygging**.
`_headers` og `_redirects` blir med i begge typer utrulling.

Supabase Auth Site URL skal være `https://gorgeous-concha-82f7a1.netlify.app`.
Legg `https://gorgeous-concha-82f7a1.netlify.app/?auth=password` i Redirect URLs.
Administrator inviterer brukere gjennom Supabase Auth; mottakeren velger selv
passord på invitasjonssiden. «Glemt passord» sender en ny lenke til samme side.
Et Auth-brukerobjekt alene gir ikke CRM-tilgang: aktivt prosjektmedlemskap må
opprettes administrativt. Konfigurer egen SMTP før invitasjoner til eksterne
testere; standardutsendingen i Supabase er begrenset.

Bedriftsarbeideren beriker eksisterende B2B-leads daglig. Den oppdager ikke nye
privatpersoner, og den utfører ingen oppringinger.

## Gratis timekjøring på GitHub Actions

`.github/workflows/enrichment.yml` kjører ved minutt 17 hver time (UTC), samt
manuelt fra Actions → Hourly company enrichment → Run workflow på `main`.
Den er sperret til repository-variabelen `ENRICHMENT_ENABLED` er `true`.
Aktivering krever repository-secret `WORKER_DATABASE_URL` med den eksisterende
begrensede `hub_jobs_runtime`-forbindelsen. Aldri bruk databaseeierens passord
eller Supabase service-role-nøkkel. Ikke legg forbindelsen i kode eller variabler.
Personer med skrivetilgang til repoet kan lage workflows som bruker secrets;
begrens derfor hvem som får slik tilgang.

Jobben kjører bare i det offentlige `xamseslb/Nexflow`, på `main`, på en standard
`ubuntu-latest`-runner. GitHub tilbyr gratis standard-runnere i offentlige repoer:
https://docs.github.com/en/billing/concepts/product-billing/github-actions
Blir repoet privat, hoppes jobben over før en runner startes. Workflowen bruker
ingen Actions-cache, opplastede artifacts, betalte oppslags-API-er eller Render-worker.
Dette gjelder denne workflowen, ikke kostnader fra andre tjenester/workflows.

Hver batch tar høyst 20 forfalte jobber og starter ikke en ny jobb etter 120
sekunder. Pågående transaksjon kan fullføres etter dette; prosessen stoppes hardt
etter 180 sekunder (10 sekunders avslutningsfrist), hele Actions-jobben etter 5
minutter. En avbrutt transaksjon rulles tilbake og jobben kan prøves igjen.
`FOR UPDATE SKIP LOCKED` beskytter køen, og workflow-concurrency hindrer overlapp.
Lokal tilsvarende kommando fra `backend`:
`python -m app.worker --batch --discover --max-jobs 20 --max-seconds 120`.

Hver time hentes **forfalte** oppslag. Et vellykket kundekort oppdateres normalt
igjen neste dag; midlertidige kildefeil prøves igjen ved en senere timekjøring.
Offentlige logger viser bare antall behandlede jobber og stoppårsak, ikke
kundedata. `processed` betyr behandlede køjobber, også utsatte/ugyldige jobber,
ikke nødvendigvis vellykkede berikelser. Kontroller kilde/status/tid på kundekortet.

GitHub kan forsinke planlagte kjøringer og deaktiverer tidsplaner i offentlige
repoer etter 60 dager uten repoaktivitet. Se
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
For pause: sett `ENRICHMENT_ENABLED=false` og avbryt eventuell pågående kjøring.
For oppstart: lagre secret, aktiver variabelen og kontroller en manuell kjøring
før timejobben regnes som operativ. Render og Netlify trenger ingen ny utrulling.

## Automatisk søk etter nye bedrifter

Funksjonen «Finn bedrifter» lar prosjektets leder/administrator velge bransjer,
Cold-kø og pause/aktivere søket. Pilotområdet er Oslo (kommunenummer 0301).
Tomt bransjevalg betyr alle bransjer; katalogen bruker SSBs tosifrede næringsgrupper.
Oppslag hentes fra Brønnøysundregistrenes gratis Enhetsregister-API.

Arbeiderens `--batch --discover` undersøker én side med høyst 50 treff før den
beriker forfalte kundekort. Den husker side og posisjon mellom kjøringer.
Høyst 20 nye bedrifter opprettes per prosjekt og norsk kalenderdag, inkludert
treff til gjennomgang. Databaselås og trigger håndhever kvoten også ved
samtidige kjøringer; filterendringer nullstiller ikke kvoten. Organisasjonsnummer
er unikt per B2B-prosjekt. Eksisterende, avviste og sperrede kontakter gjenopprettes ikke.
Konkurs, avvikling, sletting og registrerte reklamereservasjoner utelates.

Et gyldig norsk telefonnummer i registeret plasserer kontakten i valgt Cold-kø.
Treff uten nummer får «Må gjennomgås» og sperres fra ringestart og automatisk
køvalg. Leder må kontrollere bedriftsnummeret og godkjenne, eller avvise treffet.
Importhistorikken viser kilde, tidspunkt og begrunnelse og lenker til kundekortet.
Selve oppringingen bruker fortsatt backendens vanlige tillatelseskontroll.

Nettsideoppslaget undersøker registrert hjemmeside og høyst to lenkede kontakt-/om-oss-sider
på samme nettsted. Eksplisitte `tel:`-lenker og merkede norske telefonnumre lagres
som forslag med kilde og tidspunkt. Robots-regler, SSRF-beskyttelse og den eksisterende
15-sekundersgrensen gjelder også kontaktsidene. Usikre eller manglende treff blir ikke
telefonnumre på leadet: lederen må kontrollere og godkjenne under «Gjennomgå».
Et enkelt ferskt treff forhåndsutfylles, men kontrollboksen er alltid tom. Eksisterende
kontakter til gjennomgang uten tidligere telefonsøk undersøkes én gang ved neste
timekjøring; ellers følger oppslaget vanlig døgnoppdatering. Ingen betalt søke-API
brukes. Bedrifter uten registrert hjemmeside krever manuell kildekontroll.

Utrullingsrekkefølge: kjør migrasjon **0012** med databaseeier, publiser ny API
og frontend, og oppdater deretter timejobbens kode. Den nye migrasjonen gir den
eksisterende begrensede arbeiderrollen målrettet innsettingsrett, med RLS og
kvotetrigger. Den oppretter ingen nye innloggingsroller eller hemmeligheter.
Før migrasjon må eventuelle eksisterende duplikater undersøkes; migrasjonen
sletter eller slår ikke sammen kundedata automatisk. Bruk prosjektets side for
aktivering. Nytt bedriftssøk krever disse utrullingene, i motsetning til den
tidligere timejobben for bare berikelse. Det opprettes ingen betalt Render-worker.
