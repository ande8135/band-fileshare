# VDI File Share

A small Dropbox/ShareFile-style app, deployed with Terraform.

- **Folders, files, versions, comments** (comments can target the whole file or one version)
- **Static site** (`web/`, vanilla JS) in a private S3 bucket behind CloudFront
- **File storage**: private S3 bucket, browser uploads/downloads via **presigned URLs**
- **Metadata**: DynamoDB (`nodes`, `versions`, `comments` tables)
- **Auth**: Cognito user pool, email+password and Google; API Gateway JWT authorizer
- **API**: one Node.js 22 Lambda (`backend/`) behind an HTTP API

All signed-in users share one workspace (everyone sees everything).

## Deploy

1. **Google OAuth client** (Google Cloud Console → APIs & Services → Credentials → OAuth client ID → *Web application*).
   Add this Authorized redirect URI, using the Cognito domain prefix you'll choose:
   `https://<cognito_domain_prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
2. Configure and apply:
   ```sh
   cd terraform
   cp terraform.tfvars.example terraform.tfvars   # edit it
   export TF_VAR_google_client_secret='GOCSPX-...'
   terraform init
   terraform apply
   ```
3. Open the `site_url` output. Sign in with Google or create an email/password account.

Changing files in `web/` or `backend/` and re-running `terraform apply` redeploys them (CloudFront caching is disabled, so changes are live immediately).

## Roles and user management

- **Administrators** can invite people (as member or administrator), change roles, and **remove / restore access** from **Manage users** in the header. **Members** can use files, versions and comments but can't manage users.
- `admin_emails` in Terraform are **owners**: permanent administrators who can't be demoted or removed in the app, so you can never lock yourself out.
- The `users` table is checked on every API request, so removing someone takes effect immediately. Their Cognito logins are also disabled and sessions revoked (best effort), and Restore re-enables them. Removal is reversible (no records are deleted), and their past files and comments stay.
- Anyone invited before roles existed is adopted automatically as a member the first time they make a request.

## Access: invite-only

- `admin_emails` get an invitation email on `terraform apply` (temporary password, set a new one on first sign-in, or just use Google with that email).
- Admins see an **Invite people** button; it creates a Cognito user and emails them. Anyone else can't register: self-signup is off, and a pre-sign-up Lambda rejects first-time Google logins unless an invited user with that email exists.
- To revoke someone: Cognito console → User pools → Users → delete (delete both the invited user and any Google-linked one with the same email). Current sessions stay valid until the 1h token expires.
- Add/remove admins by editing `admin_emails` and re-applying.

## Local development

Set `dev_origins = ["http://localhost:8080"]`, apply, then `cd web && npx serve -l 8080 .` (the deployed `config.js` is in S3; copy it into `web/` locally, don't commit it).

## How it works

- Upload: `POST /files` (or `/files/{id}/versions`) allocates a version number and returns a presigned PUT URL → browser PUTs to S3 → `POST .../complete` verifies the object exists, records its size and makes it the current version.
- Download: `GET /files/{id}/versions/{n}/download` returns a short-lived presigned GET URL (`presign_expiry_seconds`, default 15 min).
- Every version is a separate S3 object (`files/<fileId>/<version>`); nothing is overwritten.

## Deletes, trash and recovery

Nothing is ever hard-deleted:
- Deleting a file or folder (or a comment) only flags it (`status = deleted` / `deletedAt`). Folders must be empty first.
- **Trash** (button in the toolbar) lists deleted files and folders with a **Restore** button. A file's parent folder must be active (restore the folder first) and its name must be free.
- All file versions stay in S3 (bucket versioning is also on), and the API Lambda's IAM role has no `s3:DeleteObject` / `dynamodb:DeleteItem`, so even a bug can't remove data.
- Deleted comments are hidden but kept in the `comments` table (`deletedAt` set); clear that attribute in the DynamoDB console to bring one back. Users can only delete their own comments.
- There is intentionally no permanent purge. `terraform destroy` won't remove the file bucket while it holds objects.

## Profiles and file names

- Everyone can set a **display name** (✎ next to your name, prompted on first sign-in). It's stored per email in the `profiles` table and resolved at read time, so renaming yourself updates your past comments and uploads too.
- Each version records the **original file name** you uploaded (shown with 📎, and used as the download name), even if a new version has a different name than the file's.

## Notes / limits

- Uploads use a single presigned PUT (max 5 GB per file).
- Folders can only be deleted when empty; there is no rename/move yet.
- A Google user and an email/password user with the same address are separate Cognito users (comments show the email either way). Linking them needs a pre-signup Lambda trigger.
- Terraform state holds the Google client secret; use a remote, encrypted backend for real use.
