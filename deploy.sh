#!/usr/bin/env bash
# Build the web app, then plan and apply Terraform, in that order.
#
#   ./deploy.sh              build, show the plan, ask before applying
#   ./deploy.sh --yes        build and apply without asking (e.g. CI)
#   ./deploy.sh --plan       build and show the plan only
#   ./deploy.sh --skip-build reuse the existing web/dist
#
# Needs: Node 20+, npm, Terraform, AWS credentials in your environment, and
# terraform/terraform.tfvars. Set TF_VAR_google_client_secret (or Terraform will ask).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WEB="$ROOT/web"
TF="$ROOT/terraform"
PLAN_FILE="$TF/.tfplan"

AUTO_APPROVE=0
PLAN_ONLY=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) AUTO_APPROVE=1 ;;
    --plan) PLAN_ONLY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

bold() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
cleanup() { rm -f "$PLAN_FILE"; }
trap cleanup EXIT

# ---- preflight -----------------------------------------------------------
command -v terraform >/dev/null || die "terraform not found (brew install terraform)"
if [ "$SKIP_BUILD" -eq 0 ]; then
  command -v node >/dev/null || die "node not found (brew install node)"
  command -v npm >/dev/null || die "npm not found"
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required (found $(node -v))"
fi
[ -f "$TF/terraform.tfvars" ] || die "terraform/terraform.tfvars is missing (copy terraform.tfvars.example)"
if [ -z "${TF_VAR_google_client_secret:-}" ]; then
  if [ "$AUTO_APPROVE" -eq 1 ]; then
    die "TF_VAR_google_client_secret is not set (required with --yes, since Terraform can't prompt)"
  fi
  echo "note: TF_VAR_google_client_secret is not set; Terraform will prompt for it."
fi

# ---- 1. build ------------------------------------------------------------
if [ "$SKIP_BUILD" -eq 0 ]; then
  bold "Building web app"
  (cd "$WEB" && npm ci --no-audit --no-fund && npm run build)
fi
[ -f "$WEB/dist/index.html" ] || die "web/dist/index.html not found; the build didn't produce a site"

# ---- 2. plan -------------------------------------------------------------
bold "Planning infrastructure changes"
cd "$TF"
INPUT_FLAG="-input=true"
[ "$AUTO_APPROVE" -eq 1 ] && INPUT_FLAG="-input=false"
terraform init $INPUT_FLAG >/dev/null
terraform plan $INPUT_FLAG -out="$PLAN_FILE"

# Call out anything being destroyed or replaced. Data-holding resources also have
# prevent_destroy, so Terraform refuses those plans outright; this is just visibility.
DESTROYS="$(terraform show -no-color "$PLAN_FILE" | grep -E 'will be destroyed|must be replaced' || true)"
if [ -n "$DESTROYS" ]; then
  printf '\n\033[33mThese resources will be destroyed or replaced:\033[0m\n%s\n' "$DESTROYS"
  echo "(Website files under the site bucket are expected to churn between builds.)"
fi

if [ "$PLAN_ONLY" -eq 1 ]; then
  bold "Plan only; nothing applied"
  exit 0
fi

# ---- 3. apply ------------------------------------------------------------
if [ "$AUTO_APPROVE" -eq 0 ]; then
  printf '\nApply this plan? [y/N] '
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Cancelled; nothing applied."; exit 1 ;;
  esac
fi

bold "Applying"
terraform apply $INPUT_FLAG "$PLAN_FILE"

bold "Done"
echo "Site: $(terraform output -raw site_url)"
