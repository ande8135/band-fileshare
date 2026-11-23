# ---------------------------------------------------------------------------
# File store: private bucket, accessed only through presigned URLs
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "files" {
  bucket = "${local.name}-files-${data.aws_caller_identity.current.account_id}"

  # Holds every uploaded file version: Terraform refuses any plan that would delete it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Extra safety net: even a direct overwrite/delete outside the app keeps the prior object version.
resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "files" {
  bucket = aws_s3_bucket.files.id

  cors_rule {
    allowed_origins = local.allowed_origins
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket     = aws_s3_bucket.files.id
  depends_on = [aws_s3_bucket_versioning.files]

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 3
    }
  }
}

# ---------------------------------------------------------------------------
# Static website bucket (private, served via CloudFront + OAC)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "site" {
  bucket = "${local.name}-site-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn }
      }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.site]
}

locals {
  content_types = {
    html = "text/html; charset=utf-8"
    js   = "application/javascript; charset=utf-8"
    css  = "text/css; charset=utf-8"
    svg  = "image/svg+xml"
    ico  = "image/x-icon"
    png  = "image/png"
  }
  web_files = toset([for f in fileset("${path.module}/../web", "**") : f if !contains(["config.js", "index.html"], f)])

  # One version for all static assets; it changes whenever any of them changes.
  asset_version = substr(md5(join("", [for f in sort(tolist(local.web_files)) : filemd5("${path.module}/../web/${f}")])), 0, 10)
}

resource "aws_s3_object" "site" {
  for_each = local.web_files

  bucket        = aws_s3_bucket.site.id
  key           = each.value
  source        = "${path.module}/../web/${each.value}"
  etag          = filemd5("${path.module}/../web/${each.value}")
  content_type  = lookup(local.content_types, reverse(split(".", each.value))[0], "application/octet-stream")
  cache_control = "public, max-age=31536000, immutable"
}

# index.html used to be one of the aws_s3_object.site objects. Without this, Terraform would
# delete that object and create this one in parallel; both use the same key, so the delete
# could remove the new page. "moved" turns it into a plain in-place update.
moved {
  from = aws_s3_object.site["index.html"]
  to   = aws_s3_object.index
}

# index.html is served with no-cache and points at the current asset version. It also
# preconnects to the API and Cognito so the first API call doesn't pay for a TLS handshake.
resource "aws_s3_object" "index" {
  bucket        = aws_s3_bucket.site.id
  key           = "index.html"
  content_type  = "text/html; charset=utf-8"
  cache_control = "no-cache"
  content = replace(
    replace(
      replace(
        replace(
          file("${path.module}/../web/index.html"),
          "<!--PRECONNECT-->",
          "<link rel=\"preconnect\" href=\"${aws_apigatewayv2_api.api.api_endpoint}\" crossorigin><link rel=\"preconnect\" href=\"https://${var.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com\" crossorigin>"
        ),
        "app.js\"", "app.js?v=${local.asset_version}\""
      ),
      "style.css\"", "style.css?v=${local.asset_version}\""
    ),
    "logo.png\"", "logo.png?v=${local.asset_version}\""
  )
}

# Runtime config consumed by the static site (no secrets in here).
resource "aws_s3_object" "config" {
  bucket        = aws_s3_bucket.site.id
  key           = "config.js"
  content_type  = "application/javascript; charset=utf-8"
  cache_control = "no-cache"
  content = <<-EOT
    window.APP_CONFIG = ${jsonencode({
  apiUrl        = aws_apigatewayv2_api.api.api_endpoint
  cognitoDomain = "${var.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com"
  clientId      = aws_cognito_user_pool_client.web.id
  redirectUri   = "${local.site_url}/"
})};
  EOT
}
