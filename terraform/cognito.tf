resource "aws_cognito_user_pool" "main" {
  name                = "${local.name}-users"
  deletion_protection = "ACTIVE"

  # Replacing the pool would sign everyone out and lose every account. Refuse instead.
  lifecycle {
    prevent_destroy = true
  }

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"

  # Invite-only: nobody can self-register.
  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "You're invited to VDI File Share"
      email_message = "You've been invited to VDI File Share at ${local.site_url}. Sign in with email {username} and temporary password {####} (or use Google with this email)."
      sms_message   = "Username {username}, temporary password {####}"
    }
  }

  # Blocks first-time Google sign-ins from anyone who hasn't been invited.
  lambda_config {
    pre_sign_up = aws_lambda_function.presignup.arn
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }

  attribute_mapping = {
    email    = "email"
    name     = "name"
    username = "sub"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = local.callback_urls
  logout_urls                          = local.callback_urls
  supported_identity_providers         = ["COGNITO", aws_cognito_identity_provider.google.provider_name]

  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user" "admin" {
  for_each = toset([for e in var.admin_emails : lower(e)])

  # AdminCreateUser invokes the pre-sign-up Lambda, which Cognito may only call once this
  # permission exists. The permission needs the pool ARN, so it can't be created earlier.
  depends_on = [aws_lambda_permission.presignup]

  user_pool_id             = aws_cognito_user_pool.main.id
  username                 = each.value
  desired_delivery_mediums = ["EMAIL"]

  attributes = {
    email          = each.value
    email_verified = "true"
  }
}

# Branding for the Cognito hosted sign-in page.
resource "aws_cognito_user_pool_ui_customization" "main" {
  user_pool_id = aws_cognito_user_pool.main.id
  image_file   = filebase64("${path.module}/../web/public/logo.png")
  css          = <<-EOT
    .banner-customizable { background-color: #231f20; }
    .submitButton-customizable { background-color: #ff6000; border-color: #ff6000; }
    .submitButton-customizable:hover { background-color: #e05500; }
    .inputField-customizable:focus { border-color: #ff6000; }
  EOT

  depends_on = [aws_cognito_user_pool_domain.main]
}
