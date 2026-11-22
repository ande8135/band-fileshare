locals {
  name            = var.name
  site_url        = "https://${aws_cloudfront_distribution.site.domain_name}"
  allowed_origins = concat([local.site_url], var.dev_origins)
  callback_urls   = [for o in local.allowed_origins : "${o}/"]
}
