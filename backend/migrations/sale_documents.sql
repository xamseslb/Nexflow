CREATE FUNCTION hub_private.sale_document_allowed(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT array_length(string_to_array(object_name, '/'), 1) = 3
 AND length(split_part(object_name, '/', 3)) BETWEEN 1 AND 180
 AND EXISTS (
   SELECT 1 FROM hub.sales s JOIN hub.memberships m ON m.project_id=s.project_id
   WHERE m.user_id=auth.uid() AND m.active AND
     (m.role IN ('leader','admin') OR (m.role IN ('seller','closer') AND s.seller_id=m.user_id))
     AND s.id::text=split_part(object_name, '/', 2) AND s.project_id::text=split_part(object_name, '/', 1)
 )
$$;
REVOKE ALL ON FUNCTION hub_private.sale_document_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hub_private.sale_document_allowed(text) TO authenticated;

-- Stock PostgreSQL test installations can run the same CRM schema without a Storage service.
DO $migration$
BEGIN
 IF to_regclass('storage.objects') IS NOT NULL AND to_regclass('storage.buckets') IS NOT NULL THEN
   INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
   VALUES ('nexflow-sale-documents','nexflow-sale-documents',false,5242880,ARRAY['application/pdf','image/jpeg','image/png']);
   CREATE POLICY nexflow_document_read ON storage.objects FOR SELECT TO authenticated
     USING (bucket_id='nexflow-sale-documents' AND hub_private.sale_document_allowed(name));
   CREATE POLICY nexflow_document_add ON storage.objects FOR INSERT TO authenticated
     WITH CHECK (bucket_id='nexflow-sale-documents' AND hub_private.sale_document_allowed(name));
   -- Existing permissive policies from other buckets must never open this private bucket.
   CREATE POLICY nexflow_document_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon USING (bucket_id <> 'nexflow-sale-documents') WITH CHECK (bucket_id <> 'nexflow-sale-documents');
   CREATE POLICY nexflow_document_guard ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
     USING (bucket_id <> 'nexflow-sale-documents' OR hub_private.sale_document_allowed(name))
     WITH CHECK (bucket_id <> 'nexflow-sale-documents' OR hub_private.sale_document_allowed(name));
   CREATE POLICY nexflow_document_immutable ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
     USING (bucket_id <> 'nexflow-sale-documents') WITH CHECK (bucket_id <> 'nexflow-sale-documents');
   CREATE POLICY nexflow_document_keep ON storage.objects AS RESTRICTIVE FOR DELETE TO PUBLIC
     USING (bucket_id <> 'nexflow-sale-documents');
 END IF;
END
$migration$;

