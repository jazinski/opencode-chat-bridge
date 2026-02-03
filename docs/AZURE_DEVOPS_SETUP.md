# Azure DevOps Webhook Integration Setup

This guide walks you through setting up Azure DevOps webhooks to trigger
AI-powered workflows when you @mention the bot in work items.

## Overview

The OpenCode Chat Bridge can respond to @mentions in Azure DevOps work items and
automatically:

- Research technical topics with multiple AI agents
- Perform multi-perspective code reviews
- Investigate bugs systematically
- Post results back to work items

## Architecture

```
Azure DevOps → Webhook → Bot Server → Workflow Engine → Multiple AI Agents → Results
```

**Endpoint:** `https://bot.appski.me/webhooks/azure-devops`

## Prerequisites

1. Access to Azure DevOps organization with project admin rights
2. OpenCode Chat Bridge server running at `bot.appski.me`
3. Webhook secret (shared between Azure DevOps and the bot)

## Step 1: Configure Environment Variables

Add these to your `.env` file:

```bash
# Azure DevOps Webhook Configuration
AZURE_DEVOPS_WEBHOOK_SECRET=your-secure-webhook-secret-here
AZURE_DEVOPS_BOT_NAME=@OpenCodeBot
# AZURE_DEVOPS_ALLOWED_IPS=  # Optional: IP whitelist for extra security

# Workflow Configuration
WORKFLOW_TIMEOUT_MINUTES=30
WORKFLOW_MAX_AGENTS=5
```

**Important:** Use a strong, random webhook secret. Generate one with:

```bash
openssl rand -hex 32
```

## Step 2: Create Service Hook in Azure DevOps

1. **Navigate to Project Settings**
   - Go to your Azure DevOps project
   - Click "Project Settings" (bottom left)
   - Select "Service hooks" under "General"

2. **Create New Subscription**
   - Click the green "+" icon to create a new subscription
   - Select "Web Hooks" as the service type
   - Click "Next"

3. **Configure Trigger**
   - **Trigger on:** Select "Work item commented on"
   - **Filters:**
     - Area path: (leave blank or specify specific areas)
     - Work item type: (leave blank for all, or select specific types)
   - Click "Next"

4. **Configure Action**
   - **URL:** `https://bot.appski.me/webhooks/azure-devops`
   - **HTTP headers:** (leave blank)
   - **Basic authentication:**
     - Username: `bot` (can be anything)
     - Password: `<your-webhook-secret>` (from .env file)
   - **Resource details to send:** Select "All"
   - **Messages to send:** Select "All"
   - Click "Test" to verify connection
   - Click "Finish" to save

5. **Repeat for Other Events (Optional)** You can create additional
   subscriptions for:
   - "Work item created"
   - "Work item updated"

## Step 3: Test the Integration

1. **Create or open a work item** in your Azure DevOps project

2. **Add a comment with an @mention:**
   ```
   @OpenCodeBot research authentication best practices for Node.js APIs
   ```

3. **Check the bot server logs:**
   ```bash
   # If running as systemd service
   journalctl -u opencode-chat-bridge -f

   # Or check your log file
   tail -f /path/to/logs/opencode-chat-bridge.log
   ```

4. **Expected behavior:**
   - Bot detects the @mention
   - Identifies intent: "research authentication best practices..."
   - Triggers the research workflow
   - Multiple AI agents work in parallel
   - Results are synthesized and posted back (TODO: not yet implemented)

## Available Workflows

### 1. Research Workflow

**Trigger words:** `research`, `investigate`

**Example:**

```
@OpenCodeBot research GraphQL vs REST API design patterns
```

**What it does:**

- Agent 1: Primary research on the topic
- Agent 2: Technical deep dive and implementation details
- Agent 3: Alternatives and comparative analysis
- Synthesis: Comprehensive report with recommendations

### 2. Code Review Workflow

**Trigger words:** `review`, `code review`

**Example:**

```
@OpenCodeBot review the latest pull request for security issues
```

**What it does:**

- Agent 1: Security-focused review
- Agent 2: Performance analysis
- Agent 3: Maintainability assessment
- Synthesis: Consolidated review with prioritized feedback

### 3. Bug Investigation Workflow

**Trigger words:** `bug`, `issue`, `fix`

**Example:**

```
@OpenCodeBot investigate why authentication fails intermittently
```

**What it does:**

- Agent 1: Create reproduction steps
- Agent 2: Root cause analysis
- Agent 3: Solution design
- Synthesis: Complete bug report with fix plan

## Security Considerations

### Webhook Authentication

The bot validates incoming webhooks using:

1. **Basic Auth:** Azure DevOps sends credentials in the Authorization header
2. **Secret Validation:** Password must match `AZURE_DEVOPS_WEBHOOK_SECRET`
3. **IP Whitelist (Optional):** Restrict to known Azure DevOps IP ranges

### IP Whitelist Configuration

If you want to restrict webhooks to known Azure DevOps IPs:

```bash
AZURE_DEVOPS_ALLOWED_IPS=13.107.6.0/24,13.107.9.0/24,13.107.42.0/24
```

Find current Azure DevOps IP ranges here:
https://learn.microsoft.com/en-us/azure/devops/organizations/security/allow-list-ip-url

### HTTPS

The webhook endpoint **must** use HTTPS in production. Azure DevOps requires
secure connections.

## Troubleshooting

### Webhook Not Receiving Events

1. **Check Service Hook Status**
   - Go to Project Settings → Service hooks
   - Click on your subscription
   - Check "History" tab for delivery attempts

2. **Test Connection**
   - Edit your service hook
   - Click "Test" button
   - Check if test succeeds

3. **Verify Webhook Secret**
   ```bash
   # The password in Azure DevOps must match exactly
   grep AZURE_DEVOPS_WEBHOOK_SECRET .env
   ```

4. **Check Server Logs**
   ```bash
   # Look for webhook validation errors
   journalctl -u opencode-chat-bridge | grep webhook
   ```

### Bot Not Responding to @Mentions

1. **Verify Bot Name**
   ```bash
   # Must match exactly (case-insensitive)
   grep AZURE_DEVOPS_BOT_NAME .env
   ```

2. **Check Mention Format**
   - Azure DevOps uses `@<DisplayName>`
   - Make sure your bot name matches what you type

3. **Review Logs**
   ```bash
   # Check if mention was detected
   journalctl -u opencode-chat-bridge | grep "Bot mentioned"
   ```

### Workflow Not Starting

1. **Check Intent Recognition**
   - Log should show: "Selected workflow: [name]"
   - If not, your intent might not match any workflow keywords

2. **Verify Workflow Registration**
   ```bash
   # Should see "Registered 3 example workflows" on startup
   journalctl -u opencode-chat-bridge | grep "Registered.*workflows"
   ```

3. **Check Workflow Engine**
   ```bash
   # Look for workflow execution logs
   journalctl -u opencode-chat-bridge | grep "workflow.started"
   ```

## Monitoring

### Health Check Endpoint

Check webhook configuration:

```bash
curl https://bot.appski.me/webhooks/health
```

Response:

```json
{
  "status": "ok",
  "webhooks": {
    "azureDevOps": {
      "configured": true,
      "botName": "@OpenCodeBot",
      "ipWhitelist": false
    }
  }
}
```

### Workflow Status API (Coming Soon)

```bash
# Get active workflows
curl https://bot.appski.me/api/workflows/active

# Get workflow execution details
curl https://bot.appski.me/api/workflows/executions/{executionId}
```

## Next Steps

- [ ] Implement posting results back to work items
- [ ] Add workflow status updates to work items
- [ ] Create custom workflows for your team
- [ ] Set up workflow templates
- [ ] Configure team-specific agent settings

## Resources

- [Azure DevOps Service Hooks Documentation](https://learn.microsoft.com/en-us/azure/devops/service-hooks/overview)
- [Azure DevOps REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops)
- [OpenCode Documentation](https://opencode.dev)

## Support

For issues or questions:

1. Check the
   [GitHub Issues](https://github.com/your-org/opencode-chat-bridge/issues)
2. Review server logs for error details
3. Test webhook delivery in Azure DevOps Service Hooks UI
