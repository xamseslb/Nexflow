-- CI ONLY: minimal Supabase Auth contract for a disposable stock PostgreSQL database.
-- Never run against a real Supabase project; Supabase already owns these objects.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;

-- Storage metadata subset used to exercise bucket policies on disposable PostgreSQL.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects(bucket_id text REFERENCES storage.buckets(id), name text, PRIMARY KEY(bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, anon;
