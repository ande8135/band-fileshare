# Band Fileshare

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

## Local development

Set `dev_origins = ["http://localhost:8080"]`, apply, then `cd web && npx serve -l 8080 .` (the deployed `config.js` is in S3; copy it into `web/` locally, don't commit it).

## How it works

- Upload: `POST /files` (or `/files/{id}/versions`) allocates a version number and returns a presigned PUT URL → browser PUTs to S3 → `POST .../complete` verifies the object exists, records its size and makes it the current version.
- Download: `GET /files/{id}/versions/{n}/download` returns a short-lived presigned GET URL (`presign_expiry_seconds`, default 15 min).
- Every version is a separate S3 object (`files/<fileId>/<version>`); nothing is overwritten.

## Notes / limits

- Uploads use a single presigned PUT (max 5 GB per file).
- Folders can only be deleted when empty; there is no rename/move yet.
- A Google user and an email/password user with the same address are separate Cognito users (comments show the email either way). Linking them needs a pre-signup Lambda trigger.
- Self-signup is on by default; set `allow_self_signup = false` to invite users from the Cognito console instead.
- Terraform state holds the Google client secret; use a remote, encrypted backend for real use.
