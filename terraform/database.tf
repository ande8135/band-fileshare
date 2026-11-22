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

  global_secondary_index {
    name            = "by-parent"
    hash_key        = "parentId"
    range_key       = "nameLower"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
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

  point_in_time_recovery {
    enabled = true
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

  point_in_time_recovery {
    enabled = true
  }
}
