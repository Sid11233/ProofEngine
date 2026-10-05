# Limits and abuse controls

Every limit below is enforced on the server (in the database or in code), never only in the UI. Values marked **env** can be changed with an environment variable; defaults are in [src/lib/limits.ts](../src/lib/limits.ts).

## Interview links

| Control | Value | Where |
| --- | --- | --- |
| Link lifetime | 30 days (database caps at 90) | `create_proof_request`, `rotate_request_token` |
| Link lookups | 30 per minute per IP, 60 per minute per token | `resolveInterview()` |
| Bad links | one identical 404 for unknown, malformed, expired, revoked and completed links | `resolveInterview()` |
| Reminders | max 3 per request, at least 48 hours apart, only while unanswered | `rotate_request_token` |
| Interviews per month | free 3, pro 100, team 1000 (placeholders until plans are decided) | `plan_interview_limit()` |

## Interview endpoints

| Control | Value | Where |
| --- | --- | --- |
| Starts per IP | 5 per hour (**env** `INTERVIEW_STARTS_PER_IP_HOUR`) | `/api/interview/start` |
| Bot check | Cloudflare Turnstile, verified server-side; skipped only while `TURNSTILE_SECRET_KEY` is unset | `/api/interview/start` |
| Messages | 10 per minute per token; 40 per interview; 1000 characters each | `/api/interview/message`, `record_client_message` |
| Tokens | 100,000 per interview | `record_client_message` |
| One reply at a time | a second answer is refused while one is in flight (60 s stale timeout) | `record_client_message` |
| Request body | 16 KB for JSON, 2 MB + overhead for uploads, read with a hard cap | `guardInterviewRequest` |
| Model output | max 300 tokens, validated before display | `src/lib/ai` |

## Uploads

| Control | Value |
| --- | --- |
| Kinds | logo and headshot only |
| Types | PNG, JPG, WebP, decided from the file's own bytes; SVG and everything else refused |
| Size | 2 MB; decoded images over 24 megapixels are refused (decompression bombs) |
| Count | 4 files per interview; 10 upload requests per minute per token |
| Processing | re-encoded to WebP (drops EXIF, GPS and anything hidden in the file), resized to fit 1200 px |
| Storage | private `uploads` bucket, `{workspace_id}/{interview_id}/{uuid}.webp`, original name never used; served only by signed URLs valid for 60 seconds |

## AI spend

| Control | Value | Where |
| --- | --- | --- |
| Monthly AI messages per workspace | free 100, pro 3000, team 20000 (**env** `AI_MESSAGES_FREE`, `AI_MESSAGES_PRO`, `AI_MESSAGES_TEAM`) | checked before every model call |
| When a workspace reaches it | the interview carries on with fixed wording and no model call, so a client is never cut off because of the owner's quota | `canUseAi` |
| Daily platform circuit breaker | 2,000,000 tokens per UTC day (**env** `AI_DAILY_TOKEN_LIMIT`) | `check_ai_breaker` |
| When the breaker trips | every interview page and endpoint shows a maintenance message until the next UTC day; one alert email goes to `ALERT_EMAIL` | `breakerTripped()` |

## Accounts

| Control | Value |
| --- | --- |
| Login, signup, password reset | 5 per 15 minutes per email, 20 per hour per IP |
| MFA codes | 5 per 15 minutes per user, per step (sign-in, re-auth, enrolment) |
| Invitations | 20 per hour per user |
| Recent sign-in for sensitive actions | 10 minutes (**env** `REAUTH_MAX_AGE_SECONDS`) |

## Rate limiting backend

Limits use Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. Without them they are counted per server instance, which slows an attacker down but does not stop one on a multi-instance deployment. **Configure Upstash before launch.**
