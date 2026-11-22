output "site_url" {
  description = "Open this to use the app."
  value       = local.site_url
}

output "google_authorized_redirect_uri" {
  description = "Add this as an Authorized redirect URI on your Google OAuth client."
  value       = "https://${var.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com/oauth2/idpresponse"
}

output "api_url" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "files_bucket" {
  value = aws_s3_bucket.files.id
}
