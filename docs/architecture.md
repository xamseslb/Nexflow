# Arkitektur og sikkerhetsgrenser

## Obligatorisk stack

React, TypeScript, Vite, Tailwind CSS, shadcn/ui og PWA. Python, FastAPI,
Pydantic, SQLAlchemy og Alembic. Supabase PostgreSQL, Auth, RLS og senere private
Storage-bøtter. Realtime innføres bare der det gir dokumentert nytte. Pytest,
Playwright og Docker. REA er kun et utviklingsverktøy for autorisert research.
Java-dashboardet er ikke modifisert; integrasjonen venter på dokumentasjon.

## Gjennomført sikkerhetsdesign

- Browser autentiserer med Supabase Auth. FastAPI validerer JWT-signatur via JWKS,
  issuer, audience, exp, iat og bruker-ID. Anonyme Auth-brukere avvises.
- Ingen service-role-nøkkel brukes i frontend eller ordinær API-drift.
- Runtime har ikke superuser/BYPASSRLS. Hver SQLAlchemy-transaksjon bruker
  `SET LOCAL ROLE hub_api` og transaksjonslokale claims fra verifisert token.
- Databasecommit skjer før API-svaret leveres (function-scoped dependency).
- `hub` eksponeres ikke i Supabase Data API. Nettleseren får ingen direkte
  skriverettigheter. Alle operasjoner går via API og prosjektmedlemskap.
- RLS sjekker aktive medlemskap i databasen. SECURITY DEFINER-funksjonene har
  låst search_path, eksplisitte grants og begrenset returformat. Migreringsrollen
  eier dem; runtime må aldri eie tabellene eller funksjonene.
- Partnerbrukere har lesetilgang til prosjektets leads/møter, men ikke interne
  salgsfordelinger. Partnerens økonomirapport er fortsatt en egen leveranse.
- Sammenkoblede nøkler avviser krysskobling av partner, prosjekt, lead og produkt.
- Arbeideren har kun jobb- og B2B-berikelsesprivilegier. Den kan ikke endre
  økonomi, samtykke, medlemskap eller autentisering.

## Atomicitet

Leadreservasjon og ringestart bruker radlås. Salg bruker radlås, unik
idempotensnøkkel og rådgivende transaksjonslås. Selgerflytting serialiseres per
selger og journalføres på begge prosjekter. Første versjon støtter bare frigjøring
av åpne leads; «følger med» krever avklart eierskap og B2C-samtykke.

Møter bruker en databaseutløser som serialiserer booking per closer og sjekker
overlapp på tvers av prosjekter uten å eksponere andre partneres data.
Samtidighetsgarantien må verifiseres mot faktisk PostgreSQL før produksjon.

## Økonomi

Første implementering støtter direkte salg med produktpris og prosentfordeling
i basispunkter. Prisen hentes på serveren. Beløp er heltall i øre; hub og selger
avrundes ned, partneren mottar resten. Regelversjon og beregningsgrunnlag kopieres
til salget og oppdateres ikke når produktet endres.

Godkjenning er adskilt fra registrering. Eget salg kan ikke selvgodkjennes.
B2C uten bekreftelse avvises. Ingen endpoint kan merke et salg utbetalt.
Fastlønn, timer, møtehonorar, trinnbonus, løpende provisjon, clawback og faktisk
utbetalingsgrunnlag kommer i påfølgende migreringer; de er ikke simulert som ekte lønn.

## Personvern og PWA

API-svar får no-store. Service worker cacher kun statiske appressurser, ikke API-svar.
Offline ringing, reservasjon og salgsregistrering er ikke tillatt. Lokal demo lagrer
ikke data permanent. Supabase administrerer brukerens auth-sesjon i nettleseren;
XSS-beskyttelse, CSP og sesjonshåndtering skal hardnes før produksjon.

En telefonlenke kan ikke hindre manuell ringing utenfor CRM-et. «Samtale startet»
betyr at CRM har autorisert overgangen til telefonappen, ikke at telefonen faktisk
ble besvart. Den faktiske samtalen registreres av brukeren.

## Eksterne tjenester og videre arbeid

Brreg Enhetsregisteret har en implementert klient med feltliste og kontrakttest.
Regnskapsregister, AI-oppsummering, Reservasjonsregisteret, SMS/e-post,
webhooks, private filer og CRM-adaptere er ikke aktivert. B2C feiler lukket uten
registerdokumentasjon eller gyldig samtykke. En faktisk skriftlig akseptflyt må
implementeres før B2C kan gå videre fra «venter bekreftelse».

Dashboardintegrasjonen krever API-/SSO-kartlegging og autorisert tilgang. Ingen
antakelse om eksisterende Java-rammeverk, database eller identitetsleverandør er gjort.
