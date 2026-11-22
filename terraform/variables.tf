variable "aws_region" {
  description = "Region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Prefix for resource names. Lowercase letters, digits and hyphens."
  type        = string
  default     = "bandfileshare"
}

variable "cognito_domain_prefix" {
  description = <<-EOT
    Prefix for the Cognito hosted-UI domain (<prefix>.auth.<region>.amazoncognito.com).
    Must be unique within the region. You need to know it BEFORE the first apply because
    Google needs the redirect URI https://<prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse.
  EOT
  type        = string
}

variable "google_client_id" {
  description = "OAuth 2.0 Web client ID from Google Cloud Console."
  type        = string
}

variable "google_client_secret" {
  description = "OAuth 2.0 Web client secret from Google Cloud Console."
  type        = string
  sensitive   = true
}

variable "admin_emails" {
  description = "Admins: each gets an invitation email now and can invite others from the app (Invite button)."
  type        = list(string)

  validation {
    condition     = length(var.admin_emails) > 0
    error_message = "Provide at least one admin email."
  }
}

variable "dev_origins" {
  description = "Extra origins allowed for local development, e.g. [\"http://localhost:8080\"]. Added to Cognito callback/logout URLs and to CORS."
  type        = list(string)
  default     = []
}

variable "presign_expiry_seconds" {
  description = "Lifetime of presigned upload/download URLs."
  type        = number
  default     = 900
}
