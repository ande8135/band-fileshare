# VDI File Share

A small Dropbox/ShareFile-style app, deployed with Terraform.

- **Folders, files, versions, comments** (comments can target the whole file or one version)
- **Web app** (`web/`): React + TypeScript built with Vite, served from a private S3 bucket behind CloudFront
- **File storage**: private S3 bucket, browser uploads/downloads via **presigned URLs**
- **Metadata**: DynamoDB (`nodes`, `versions`, `comments` tables)
- **Auth**: Cognito user pool, email+password and Google; API Gateway JWT authorizer
- **API**: one Node.js 22 Lambda (`backend/`) behind an HTTP API

All signed-in users share one workspace (everyone sees everything).

## Deploy

1. **Google OAuth client** (Google Cloud Console → APIs & Services → Credentials → OAuth client ID → *Web application*).
   Add this Authorized redirect URI, using the Cognito domain prefix you'll choose:
   `https://<cognito_domain_prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
2. Configure:
   ```sh
   cp terraform/terraform.tfvars.example terraform/terraform.tfvars   # edit it
   export TF_VAR_google_client_secret='GOCSPX-...'
   ```
3. Deploy (needs Node 20+, Terraform and AWS credentials):
   ```sh
   ./deploy.sh            # build web app -> terraform plan -> confirm -> apply
   ./deploy.sh --plan     # build and show the plan only
   ./deploy.sh --yes      # no confirmation prompt (CI)
   ```
   The script runs `npm ci && npm run build` in `web/`, then `terraform init`, saves a plan, lists anything that would be destroyed or replaced, asks for confirmation, and applies exactly that plan. Running `terraform apply` by hand also works, as long as `web/dist` has been built first; without it the plan fails instead of uploading an empty site.
4. Open the `site_url` output and sign in (an invitation email was sent to each `admin_emails` address).

Re-running `./deploy.sh` after changing `web/` or `backend/` redeploys them. `index.html` and `config.js` are served `no-cache`; Vite's content-hashed files in `assets/` are cached for a year, so changes are live on the next page load without CloudFront invalidations.

## Roles and user management

- **Administrators** can invite people (as member or administrator), change roles, and **remove / restore access** from the **Members** page. **Members** can use files, versions and comments but can't manage users.
- `admin_emails` in Terraform are **owners**: permanent administrators who can't be demoted or removed in the app, so you can never lock yourself out.
- The `users` table is checked on every API request, so removing someone takes effect immediately. Their Cognito logins are also disabled and sessions revoked (best effort), and Restore re-enables them. Removal is reversible (no records are deleted), and their past files and comments stay.
- Anyone invited before roles existed is adopted automatically as a member the first time they make a request.

## Access: invite-only

- `admin_emails` get an invitation email on `terraform apply` (temporary password, set a new one on first sign-in, or just use Google with that email).
- Admins see an **Invite people** button; it creates a Cognito user and emails them. Anyone else can't register: self-signup is off, and a pre-sign-up Lambda rejects first-time Google logins unless an invited user with that email exists.
- To revoke someone: Cognito console → User pools → Users → delete (delete both the invited user and any Google-linked one with the same email). Current sessions stay valid until the 1h token expires.
- Add/remove admins by editing `admin_emails` and re-applying.

## Guitar Pro preview

`.gp`, `.gpx`, `.gp3`, `.gp4` and `.gp5` files get a **Preview** button (details panel, row menu, and per version in the Versions tab). It opens a read-only viewer built on [alphaTab](https://www.alphatab.net/) that renders the notation and tab and plays it back with alphaTab's built-in MIDI synthesizer:

- Play/pause (space), stop, click the progress bar or a beat to jump
- Track picker (one track or **All tracks**), speed (50–150%), metronome, count-in, loop, volume, zoom, single-line layout
- **Mixer**: mute, solo and per-track volume (0–150%) for each instrument, starting from the mute/solo saved in the file. It only changes what that listener hears; the file isn't modified
- Nothing in the viewer can change the file

alphaTab, its notation font (Bravura) and soundfont (Sonivox) load only when a preview is opened, about 300 KB of compressed code plus ~1 MB of sounds, so normal page loads are unaffected. The file itself is fetched through the same short-lived presigned URL used for downloads.

## Performance notes

- TanStack Query caches folder listings: going back to a folder renders instantly and refreshes in the background. Hovering a folder prefetches it, and duplicate requests are merged.
- The details panel opens immediately from the row's data and loads versions and comments in one request (`GET /files/{id}?include=comments`).
- The API Lambda runs on arm64 with 1 GB of memory (Lambda CPU scales with memory), and independent DynamoDB reads run in parallel.
- `index.html` preconnects to the API and Cognito so the first request skips the TLS handshake.

## Local development

```sh
cd web
npm install
cp ../path/to/deployed/config.js public/config.js   # or write one; see below (git-ignored)
npm run dev                                          # http://localhost:8080
```

`public/config.js` sets `window.APP_CONFIG = { apiUrl, cognitoDomain, clientId, redirectUri: "http://localhost:8080/" }` (the deployed copy is at `<site_url>/config.js`; change `redirectUri`). Add `dev_origins = ["http://localhost:8080"]` to `terraform.tfvars` and deploy once so Cognito and CORS accept the local origin.

`npm run typecheck` and `npm run build` (type-check + production bundle) are what the deploy script runs.

### Front-end layout

- `src/lib/`: API client, auth (PKCE), TanStack Query definitions (`queries.ts`), shared mutations (`actions.tsx`), types, routing
- `src/components/`: UI primitives, dialogs, menus, toasts, uploads tray, details panel
- `src/pages/`: Files, Trash, Members

## How it works

- Upload: `POST /files` (or `/files/{id}/versions`) allocates a version number and returns a presigned PUT URL → browser PUTs to S3 → `POST .../complete` verifies the object exists, records its size and makes it the current version.
- Download: `GET /files/{id}/versions/{n}/download` returns a short-lived presigned GET URL (`presign_expiry_seconds`, default 15 min).
- Every version is a separate S3 object (`files/<fileId>/<version>`); nothing is overwritten.

## Deletes, trash and recovery

Nothing is ever hard-deleted:
- Deleting a file or folder (or a comment) only flags it (`status = deleted` / `deletedAt`). Folders must be empty first.
- **Trash** (button in the toolbar) lists deleted files and folders with a **Restore** button. A file's parent folder must be active (restore the folder first) and its name must be free.
- All file versions stay in S3 (bucket versioning is also on), and the API Lambda's IAM role has no `s3:DeleteObject` / `dynamodb:DeleteItem`, so even a bug can't remove data.
- Deleted comments are hidden but kept in the `comments` table (`deletedAt` set); clear that attribute in the DynamoDB console to bring one back. Users can only edit or delete their own comments. Edited comments show "(edited)", and each previous version of the text is kept in the comment's `history` attribute.
- There is intentionally no permanent purge. The file bucket, all DynamoDB tables and the Cognito user pool have `prevent_destroy` (Terraform errors rather than deleting or replacing them), DynamoDB deletion protection and Cognito deletion protection are on, and the tables have point-in-time recovery (35 days). To ever tear the stack down you'd have to remove those deliberately.

## Profiles and file names

- Everyone can set a **display name** (✎ next to your name, prompted on first sign-in). It's stored per email in the `profiles` table and resolved at read time, so renaming yourself updates your past comments and uploads too.
- Each version records the **original file name** you uploaded (shown with 📎, and used as the download name), even if a new version has a different name than the file's.

## Notes / limits

- Uploads use a single presigned PUT (max 5 GB per file).
- Files and folders can be renamed and moved (drag and drop, or the ⋯ menu; a folder's own ⋯ is next to its title). Previous names are kept in `nameHistory`, and downloads use the current name. Renaming or moving a folder rewrites the stored path of everything inside it, including trashed items, up to 5,000 items per operation. Folders can only be trashed when empty.
- A Google user and an email/password user with the same address are separate Cognito users (comments show the email either way). Linking them needs a pre-signup Lambda trigger.
- Terraform state holds the Google client secret; use a remote, encrypted backend for real use.
