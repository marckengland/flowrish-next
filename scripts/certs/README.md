# Supabase production database trust root

`supabase-prod-ca-2021.crt` is a public CA certificate, not a private key or credential. The migration helper uses it with Prisma's `sslmode=require` and `sslaccept=strict` to verify the intended database server.

Source: [Supabase Studio's certificate URL configuration](https://github.com/supabase/supabase/blob/4a9b2b6860805d11b76b59ff29b8803925f2ec38/apps/studio/hooks/custom-content/custom-content.json), expanded for the production environment:

<https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt>

SHA-256 certificate fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

Valid from April 28, 2021 through April 26, 2031. The helper checks both the fingerprint and validity period before starting Prisma. To rotate it, obtain the replacement through Supabase's authenticated dashboard or official Studio source, verify the certificate and intended endpoint, then review the certificate and helper fingerprint changes together. Never disable certificate verification to unblock a release.
