# source this: points the app and the isolation/e2e tests at the local stack.
SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
read -r ANON SERVICE < <(node -e '
const c=require("crypto");const s=process.argv[1];
const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const sign=r=>{const h=b({alg:"HS256",typ:"JWT"}),p=b({role:r,iss:"supabase-demo",iat:1700000000,exp:4102444800});return h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url")};
console.log(sign("anon"),sign("service_role"));' "$SECRET")
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON SUPABASE_SERVICE_ROLE_KEY=$SERVICE
export NEXT_PUBLIC_APP_URL=http://localhost:3111
export ISOLATION_SUPABASE_URL=http://127.0.0.1:54321 ISOLATION_SUPABASE_ANON_KEY=$ANON ISOLATION_SUPABASE_SERVICE_ROLE_KEY=$SERVICE
