# Nexflow CRM

Mobil-først CRM for partnerhuben. React + TypeScript + Vite + Tailwind + shadcn/ui,
FastAPI + Pydantic + SQLAlchemy + Alembic, Supabase PostgreSQL + Auth + RLS.
Ingen Java-implementering og ingen alternativ database.

## Status

Første sammenhengende implementering, **ikke ferdig MVP eller klar for produksjon**.
Arbeidsflate med oversikt, prosjektbytte, søk, leadkort, ringetillatelse, samtalelogg,
møtebooking, enkel produktbasert salgsfordeling, ledergodkjenning og CSV-eksport.
Demonstrasjonen bruker kun fiktive data i minnet og utfører ingen anrop eller utsendinger.
Ekte bruk krever Supabase og migrering. Ingen auth-bypass eller lokal produksjonsdatabase.

Åpne **Ringekøer** for å opprette Hot-, Cold- og Winback-lister, tildele en selger og flytte kontakter. **Åpne liste** reserverer en kontakt. Selgeren starter anropet manuelt og lagrer utfall og notat før neste kontakt vises. **Kunder** samler salgstrinn, oppfølging, møter og samtalehistorikk.

Rapporter, diagrammer og oppfølgingskø er beskrevet i [rapporter og oppfølging](docs/reporting-and-follow-ups.md).

Se [krav og leveransestatus](docs/requirements.md) og [arkitektur](docs/architecture.md).

## Lokal start

Node 22.12+ (eller nyere kompatibel LTS) og Python 3.12 anbefales.

```powershell
npm.cmd ci --include=dev
npm.cmd run dev
```

Åpne http://127.0.0.1:8087 og velg **Åpne demonstrasjon**. Ingen nøkler er nødvendige.
Frontend bruker fast port 8087 og stopper hvis porten er opptatt.
Demoen nullstilles ved oppdatering eller prosjektbytte. Ikke skriv reelle personopplysninger i demoen.

Backend, fra prosjektroten:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend/requirements.lock
.\.venv\Scripts\python -m pip install --no-deps -e backend
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
if (!(Test-Path frontend/.env.local)) { Copy-Item frontend/.env.example frontend/.env.local }
```

Fyll inn egne verdier lokalt. Frontend får kun Supabase-URL og publishable key.
Backend bruker asymmetrisk Supabase-signering (ES256/RS256); ingen egen passorddatabase.

```powershell
cd backend
..\.venv\Scripts\python -m alembic upgrade head
..\.venv\Scripts\python -m uvicorn app.main:app --reload
```

API-dokumentasjon: http://127.0.0.1:8000/docs. Vite videresender `/api` til port 8000.
Arbeider startes fra `backend` med `python -m app.worker` etter at den separate rollen er konfigurert.

### Automatisk bedriftsoppslag

Kjør `alembic upgrade head` fra backend og hold `python -m app.worker` i gang med `WORKER_DATABASE_URL` for den begrensede arbeiderrollen. Docker Compose har en egen `worker`-tjeneste. Nye og importerte B2B-leads legges i kø. Migreringen legger også eksisterende bedriftsleads i kø. Arbeideren bruker organisasjonsnummer eller et entydig, eksakt navnetreff og planlegger neste sjekk etter ett døgn. Midlertidige kildefeil prøves igjen etter 5, 10, 20 og 40 minutter, deretter etter ett døgn.

Oppslaget bruker siste selskapsregnskap, registrerte lederroller og lesbar tekst fra bedriftens registrerte hjemmeside. Nettstedets regler for roboter respekteres. Fra `backend` kan du kjøre `python -m app.worker --lookup 996756246` for et ekte oppslag uten å skrive til databasen. I demonstrasjonen viser **Kunder → Se ekte bedriftsoppslag** et datert eksempel.

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
inn administrativt; selvbetjent onboarding er fase 3. Medlemskap refererer til `auth.users.id`.
`raw_user_meta_data.display_name` brukes kun som visningsnavn, aldri til autorisasjon.
Test minst to partnere og to prosjekter før ekte data tas inn.

## Kvalitetssikring

```powershell
npm run build
.\.venv\Scripts\python -m pytest backend/tests -q
npm run test:e2e
npm run test:pwa --workspace frontend
```

Playwright bruker installert Microsoft Edge på Windows. På Linux/CI brukes Chromium
med `PLAYWRIGHT_BROWSER=chromium` og `npx playwright install --with-deps chromium`.
Mobilprosjektet emulerer en mobilskjerm; det erstatter ikke prøving på en ekte iPhone.

PostgreSQL-integrasjonstester krever en **egen disponibel testdatabase** med migreringene
og `TEST_DATABASE_URL` satt til en administrativ tilkobling. Uten denne blir testene
eksplisitt hoppet over. De tester RLS og samtidighet; SQLite brukes ikke som erstatning.

Docker: `docker compose up --build`, med backend/.env og frontend-buildvariabler satt.
Supabase kjører eksternt. Compose starter ingen alternativ database. Migrering kjøres
separat, aldri automatisk av API-prosessen. Legg TLS/reverse proxy foran ved utrulling.

## Før produksjon

### Utrulling på Render og eksisterende Netlify-prosjekt

`render.yaml` klargjør `nexflow-api` og `nexflow-enrichment` i Frankfurt med
Docker og manuell utrulling. Begge bruker betalt, kontinuerlig drift; kontroller
prisen i Render før opprettelse. Filen oppretter ingen database. Supabase-prosjektet
`udkigapetwzmyaqztkzj` og Netlify-prosjektet `gorgeous-concha-82f7a1` beholdes.

Piloten 12. november 2026 bruker i stedet manuelt opprettet **gratis API** på
`https://nexflow-api-cms0.onrender.com`. Betalt aktivering er utsatt av eieren.
Bakgrunnsarbeideren er derfor ikke startet på Render. Den begrensede
databasebrukeren er klargjort, og arbeideren kan kjøres lokalt med
`python -m app.worker --once` for én forfalt jobb. Automatisk daglig berikelse
krever en kjørende arbeider; API-et alene utfører ikke køjobbene.
Gratis-API-et kan gå i hvile og bruke minst 50 sekunder på første forespørsel.

Pilotkontroller utført: Render-helse 200, uinnlogget prosjektforespørsel 401,
eksakt Netlify-origin i CORS, migrering 0011 og RLS på 15 CRM-tabeller.
Den faktiske begrensede databasebrukeren kan lese pilotadministratorens prosjekt,
mens en identitet uten medlemskap får null prosjekter og leads. Lokale API-lesetester
mot Supabase bestod for 11 ruter. Dette erstatter ikke full testing med to ekte
brukerøkter, ulike partnere, filopplasting og samtidige skriv.

«Pilot – bedrifter» har Hot-, Cold- og Winback-køer og ett Bouvet Norge AS-testkort,
sperret for oppringing. Ett reelt oppslag er kjørt og lagret med kilde/tidspunkt.
Neste jobb ligger i kø; den kjører først når arbeideren startes igjen.

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

Fullfør kravlisten, kjør RLS- og samtidighetstester mot Supabase, gjennomgå juridiske regler,
sett opp registerleverandør, meldingsleverandør, kvitteringslagring, sikkerhetskopiering,
rate limiting, observabilitet og gjenopprettingstest. Ikke aktiver B2C eller utbetalinger
før tilhørende integrasjoner, dokumentasjon og tester er på plass.
