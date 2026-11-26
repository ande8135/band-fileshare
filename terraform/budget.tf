# Account-wide monthly cost budget. No cost filters, so it covers everything billed to the
# AWS account, not just this app. Budget emails don't need a subscription confirmation.
resource "aws_budgets_budget" "account_monthly" {
  name         = "${local.name}-account-monthly"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Early warning: actual spend passes 80% of the budget.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = local.budget_emails
  }

  # Actual spend is over budget.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = local.budget_emails
  }

  # AWS forecasts the month will end over budget.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = local.budget_emails
  }
}

locals {
  budget_emails = length(var.budget_alert_emails) > 0 ? var.budget_alert_emails : var.admin_emails
}
