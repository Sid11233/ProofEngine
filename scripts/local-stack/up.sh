#!/bin/bash
# Hand-assembled local Supabase (Postgres + GoTrue + PostgREST + proxy) for environments where
# `supabase start` cannot work because containers cannot reach each other (e.g. some Codespaces).
# Everywhere else, use `npx supabase start`. Rebuilds from scratch and applies every migration.
set -e
cd "$(dirname "$0")/../.."
SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
docker rm -f pe-pg pe-auth pe-rest pe-storage >/dev/null 2>&1 || true
docker run -d --name pe-pg -p 54399:5432 -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:17.11.0.002 >/dev/null
for i in $(seq 1 40); do docker exec pe-pg pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 2; done
sleep 3
docker exec pe-pg psql -U supabase_admin -h 127.0.0.1 -d postgres -q -c "alter role authenticator with password 'postgres'" -c "alter role supabase_auth_admin with password 'postgres'"
docker exec pe-pg psql -U supabase_admin -h 127.0.0.1 -d postgres -q -c "alter role supabase_storage_admin with password 'postgres'" 2>/dev/null || true
docker exec pe-pg psql -U postgres -h 127.0.0.1 -q -c "create extension if not exists pgtap with schema extensions"
docker run -d --name pe-auth --network host \
 -e GOTRUE_API_HOST=127.0.0.1 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321 \
 -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:54399/postgres" \
 -e GOTRUE_SITE_URL=http://localhost:3000 -e GOTRUE_JWT_SECRET="$SECRET" -e GOTRUE_JWT_EXP=3600 \
 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
 -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
 -e GOTRUE_MFA_TOTP_ENROLL_ENABLED=true -e GOTRUE_MFA_TOTP_VERIFY_ENABLED=true \
 public.ecr.aws/supabase/gotrue:v2.197.0 >/dev/null
# Storage API (files on local disk), so upload code can run for real.
read -r ANON SERVICE < <(node -e '
const c=require("crypto");const s=process.argv[1];
const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const sign=r=>{const h=b({alg:"HS256",typ:"JWT"}),p=b({role:r,iss:"supabase-demo",iat:1700000000,exp:4102444800});return h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url")};
console.log(sign("anon"),sign("service_role"));' "$SECRET")
# GoTrue must finish its own migrations first: it adds auth.users columns our migrations use.
for i in $(seq 1 40); do sleep 2; [ "$(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:9999/health)" = 200 ] && break; done
docker run -d --name pe-storage --network host \
 -e ANON_KEY="$ANON" -e SERVICE_KEY="$SERVICE" -e AUTH_JWT_SECRET="$SECRET" -e PGRST_JWT_SECRET="$SECRET" \
 -e DATABASE_URL="postgres://supabase_storage_admin:postgres@127.0.0.1:54399/postgres" -e DB_INSTALL_ROLES=false \
 -e POSTGREST_URL="http://127.0.0.1:3000" -e SERVER_PORT=5000 -e SERVER_REGION=local -e TENANT_ID=local \
 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e GLOBAL_S3_BUCKET=local -e FILE_SIZE_LIMIT=52428800 \
 -e DB_MIGRATIONS_FREEZE_AT= -e ENABLE_IMAGE_TRANSFORMATION=false \
 public.ecr.aws/supabase/storage-api:v1.79.28 >/dev/null
for i in $(seq 1 30); do sleep 2; [ "$(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:5000/status)" = 200 ] && break; done
# Storage creates its schema first; our migrations then add the private buckets.
for f in supabase/migrations/*.sql; do
  docker exec -i pe-pg psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 -q -f - < "$f" >/dev/null || { echo "MIGRATION FAILED: $f"; exit 1; }
done
docker run -d --name pe-rest --network host \
 -e PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:54399/postgres" -e PGRST_DB_SCHEMAS=public \
 -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" -e PGRST_SERVER_PORT=3000 \
 public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
sleep 6
docker restart pe-rest >/dev/null
fuser -k 54321/tcp >/dev/null 2>&1 || true
(setsid node scripts/local-stack/proxy.mjs >/dev/null 2>&1 &)
sleep 4
echo "stack ready: proxy=$(curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:54321/rest/v1/ -H 'apikey: x')"
