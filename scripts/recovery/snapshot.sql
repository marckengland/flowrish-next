-- Stable per-table row digests, including empty tables and the migration ledger.
SELECT format('SELECT json_build_object(''table'', %L, ''rows'', count(*), ''digest'', md5(coalesce(string_agg(row_to_json(t)::text, E''\n'' ORDER BY row_to_json(t)::text), ''''))) FROM public.%I t;', tablename, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
