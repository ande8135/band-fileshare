data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../backend"
  output_path = "${path.module}/.build/api.zip"
  excludes    = ["test", "package-lock.json"]
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = 30
}

resource "aws_iam_role" "api" {
  name = "${local.name}-api"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "api" {
  name = "access"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.api.arn}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem",
        ]
        Resource = [
          aws_dynamodb_table.nodes.arn,
          "${aws_dynamodb_table.nodes.arn}/index/*",
          aws_dynamodb_table.versions.arn,
          aws_dynamodb_table.comments.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["cognito-idp:AdminCreateUser"]
        Resource = aws_cognito_user_pool.main.arn
      },
      {
        # The signer's permissions bound what presigned URLs can do.
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.files.arn}/*"
      },
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name}-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      NODES_TABLE    = aws_dynamodb_table.nodes.name
      VERSIONS_TABLE = aws_dynamodb_table.versions.name
      COMMENTS_TABLE = aws_dynamodb_table.comments.name
      FILES_BUCKET   = aws_s3_bucket.files.id
      PRESIGN_EXPIRY = tostring(var.presign_expiry_seconds)
      USER_POOL_ID   = aws_cognito_user_pool.main.id
      ADMIN_EMAILS   = join(",", [for e in var.admin_emails : lower(e)])
    }
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy.api]
}

resource "aws_apigatewayv2_api" "api" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = local.allowed_origins
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.api.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://${aws_cognito_user_pool.main.endpoint}"
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "ANY /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Cognito pre-sign-up trigger: federated (Google) sign-ups only if invited
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "presignup" {
  name              = "/aws/lambda/${local.name}-presignup"
  retention_in_days = 30
}

resource "aws_iam_role" "presignup" {
  name               = "${local.name}-presignup"
  assume_role_policy = aws_iam_role.api.assume_role_policy
}

resource "aws_iam_role_policy" "presignup" {
  name = "access"
  role = aws_iam_role.presignup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.presignup.arn}:*"
      },
      {
        # Wildcard pool id avoids a dependency cycle (the pool references this function).
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUsers"]
        Resource = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*"
      },
    ]
  })
}

resource "aws_lambda_function" "presignup" {
  function_name    = "${local.name}-presignup"
  role             = aws_iam_role.presignup.arn
  runtime          = "nodejs22.x"
  handler          = "presignup.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 10

  depends_on = [aws_cloudwatch_log_group.presignup, aws_iam_role_policy.presignup]
}

resource "aws_lambda_permission" "presignup" {
  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.presignup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
