# OrexisAI WorkConnect

WorkConnect is integrated into the existing OrexisAI Node/PostgreSQL application. It reuses the existing `users` table, hashed database sessions, security headers, same-origin protection, theme, navigation, PostgreSQL pool, and login/logout flow. It does not introduce a second application, authentication system, database, or payment flow.

## Architecture

- `workconnect/service.js` contains authenticated REST-style WorkConnect handlers, validation, ownership checks, Haversine distance queries, workflow state changes, persistent media handling, notifications, blocking, reporting and search.
- `views/workconnect.js` renders the authenticated WorkConnect application shell.
- `public/workconnect.js` is the browser client for feed, local discovery, profiles, jobs, applications, service inquiries, quotes, messaging, notifications, portfolio and reviews.
- `public/workconnect.css` extends the existing OrexisAI visual language and includes mobile layouts.
- `database/schema.sql` contains additive/idempotent WorkConnect tables and indexes. Existing records are not deleted or replaced.
- `database.js` exposes the existing pool through parameterized `query()` and transaction helpers so WorkConnect uses the same database connection mechanism.
- `test/workconnect.test.js` adds WorkConnect contract/security regression coverage.

## Environment

No new authentication or payment secrets are required.

For production, set:

```env
WORKCONNECT_MEDIA_ROOT=/absolute/path/to/a/persistent/mounted/volume/workconnect-media
```

The application intentionally refuses to initialize WorkConnect in `NODE_ENV=production` without this value, preventing production uploads from silently relying on ephemeral storage. Development defaults to `data/workconnect-media`.

`WORKCONNECT_ADMIN_EMAILS` is reserved for the moderation/admin layer; moderation reports and verification records are stored now, but a full moderator console is not included in this patch.

## Install and migrate

The project already installs from the repository root:

```powershell
npm install
npm run check
npm test
npm start
```

The existing startup calls `database.initialize()`, which executes additive `CREATE TABLE IF NOT EXISTS`, indexes and safe `ALTER TABLE` statements. Therefore a normal server start applies the WorkConnect schema to the configured PostgreSQL database.

To inspect the schema before applying it:

```powershell
Select-String -Path .\database\schema.sql -Pattern 'OrexisAI WorkConnect' -Context 0,20
```

Back up production PostgreSQL before any deployment, as with every schema change.

## Local testing

1. Sign in with an existing OrexisAI account and open **WorkConnect** from the dashboard sidebar.
2. Open **My Profile**, fill profession/skills, save it, then add a service location with actual coordinates and radius.
3. In a second account, open **Find Workers**, search the profession, then either click **Use my location** (HTTPS or localhost required by browsers) or enter manual coordinates.
4. Verify the result shows an approximate distance and never exposes the worker's precise service coordinates.
5. Send a service inquiry. On the worker account, open **My Dashboard**, propose a quote, then accept/decline it on the customer account.
6. Mark accepted work in progress/completed. The customer can then submit one authentic review; duplicate/uncompleted reviews are rejected server-side.
7. Publish a job from **Find Jobs**, apply from the other account, then review/shortlist/accept/reject from the owner account.
8. Open a professional profile and start a conversation. Verify messages remain after a refresh and are not accessible from an unrelated account.
9. Publish a professional post and optionally upload a permitted image/video/PDF after confirming publication permission.
10. Upload a profile photo and portfolio project media and verify they survive server restarts on persistent storage.

## Production deployment

1. Back up PostgreSQL.
2. Apply the patch from the OrexisAI repository root.
3. Run `npm install` (or your lockfile-preserving deployment install).
4. Configure `WORKCONNECT_MEDIA_ROOT` to durable storage with write permission for the Node process. For multi-instance deployments use a shared/object-storage adapter in place of local disk before scaling horizontally.
5. Ensure the site is served over HTTPS; browser geolocation is not available on ordinary insecure production origins.
6. Run `npm run check && npm test`.
7. Start/restart the existing OrexisAI process. Do not create a separate WorkConnect process.
8. Test two real accounts through the worker discovery, inquiry/quote, job/application and messaging journeys.

## Verification performed in this workspace

- Baseline before WorkConnect: `npm run check` passed; `npm test` passed **169/169** tests.
- After WorkConnect: `npm run check` passed; `npm test` passed **174/174** tests.
- PostgreSQL integration could not be executed in this sandbox because runtime dependencies were not installed (`pg` resolved as `MODULE_NOT_FOUND`). The uploaded `.env` points to localhost, but no claim is made that migrations or cross-account DB flows were executed here.
- Browser automation was not available, so the interaction checklist above must be run against your local PostgreSQL instance.

## Known limitations / intentionally incomplete acceptance items

This patch delivers the connected core WorkConnect application but does **not** claim the entire long-form specification is finished. The following require a follow-up production-hardening phase:

- Full administrator/moderator UI for category management, report queues, suspensions, audit logs and verification decisions.
- Government/third-party phone or identity verification; the schema distinguishes verification states but no fake verification is shown.
- Resume/certificate-specific private-document UI and retention console. The media API supports private purposes, but the end-user document workflow is not yet surfaced end-to-end.
- Rich post comment thread UI/editing, saved-post UI, job skill-tag editor, salary/distance filter UI, and invitation-to-apply UX.
- Realtime WebSockets. Messaging currently uses reliable authenticated HTTP persistence; refreshing/reopening fetches PostgreSQL history.
- Object-storage adapter (S3/R2/etc.). Production currently requires an explicitly configured persistent filesystem path and is appropriate only for a single/shared-volume deployment.
- Dedicated automated PostgreSQL integration fixtures and browser E2E tests could not be run in this environment.

These limitations are documented so the patch is not misrepresented as satisfying acceptance criteria that were not actually executed or completed.
