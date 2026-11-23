# Files and folders. Folder listing = query on the by-parent index.
resource "aws_dynamodb_table" "nodes" {
  name         = "${local.name}-nodes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
  attribute {
    name = "parentId"
    type = "S"
  }
  attribute {
    name = "nameLower"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "deletedAt"
    type = "S"
  }

  global_secondary_index {
    name            = "by-parent"
    hash_key        = "parentId"
    range_key       = "nameLower"
    projection_type = "ALL"
  }

  # Trash view: only deleted items carry deletedAt, so the index stays tiny.
  global_secondary_index {
    name            = "by-status"
    hash_key        = "status"
    range_key       = "deletedAt"
    projection_type = "ALL"
  }

  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }

  # Holds user data: Terraform refuses any plan that would delete or replace this.
  lifecycle {
    prevent_destroy = true
  }
}

# One row per uploaded version of a file.
resource "aws_dynamodb_table" "versions" {
  name         = "${local.name}-versions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "fileId"
  range_key    = "version"

  attribute {
    name = "fileId"
    type = "S"
  }
  attribute {
    name = "version"
    type = "N"
  }

  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }

  # Holds user data: Terraform refuses any plan that would delete or replace this.
  lifecycle {
    prevent_destroy = true
  }
}

# Comments on a file, optionally pinned to a specific version.
resource "aws_dynamodb_table" "comments" {
  name         = "${local.name}-comments"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "fileId"
  range_key    = "sk"

  attribute {
    name = "fileId"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }

  # Holds user data: Terraform refuses any plan that would delete or replace this.
  lifecycle {
    prevent_destroy = true
  }
}

# Display names, keyed by lowercase email (so Google and password logins share one profile).
resource "aws_dynamodb_table" "profiles" {
  name         = "${local.name}-profiles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }

  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }

  # Holds user data: Terraform refuses any plan that would delete or replace this.
  lifecycle {
    prevent_destroy = true
  }
}

# Who may use the app and in which role (admin | member). Checked on every API request.
resource "aws_dynamodb_table" "users" {
  name         = "${local.name}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }

  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }

  # Holds user data: Terraform refuses any plan that would delete or replace this.
  lifecycle {
    prevent_destroy = true
  }
}
