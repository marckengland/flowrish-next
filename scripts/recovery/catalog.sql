-- Logical definitions only: no OIDs, file locations, statistics, or row data.
SELECT jsonb_build_object(
 'columns', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.ordinal_position) FROM (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='public') x),
 'tables', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.relname) FROM (SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) x),
 'acl', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.grantee,x.privilege_type) FROM (SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema='public') x),
 'constraints', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.conname) FROM (SELECT c.conrelid::regclass::text table_name,c.conname,pg_get_constraintdef(c.oid,true) definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public') x),
 'indexes', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tablename,x.indexname) FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') x),
 'triggers', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.tgname) FROM (SELECT t.tgrelid::regclass::text table_name,t.tgname,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) x),
 'functions', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name,x.definition) FROM (SELECT p.proname name,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')) x),
 'enums', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.typname,x.enumsortorder) FROM (SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') x),
 'policies', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tablename,x.policyname) FROM (SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public') x)
);
