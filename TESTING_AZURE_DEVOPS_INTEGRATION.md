# Testing Azure DevOps Integration

## Prerequisites

Ensure `.env` file has:

```bash
AZURE_DEVOPS_ORGANIZATION=utrgv  # Confirmed configured
AZURE_DEVOPS_PAT=your-personal-access-token  # User confirmed provided
```

## Service Status

**Current Status:** ✅ Running and healthy

- Built successfully: `npm run build` completed
- Service restarted: `systemctl --user restart opencode-chat-bridge`
- Azure DevOps client initialized for organization: **utrgv**
- Webhook endpoint: `https://bot.appski.me/webhooks/azure-devops`

**Verify service:**

```bash
systemctl --user status opencode-chat-bridge
journalctl --user -u opencode-chat-bridge -f
```

## Available Workflows

### 1. Research Workflow

**Trigger:** `@appski research [topic]`

- 3 parallel agents (12 min total)
- Literature review, web research, industry analysis
- Produces comprehensive research report

### 2. Code Review Workflow

**Trigger:** `@appski code-review [description]`

- 4 parallel agents (15 min total)
- Security, performance, testing, documentation review
- Produces detailed code review report

### 3. Bug Investigation Workflow

**Trigger:** `@appski bug-investigation [description]`

- 3 sequential agents (20 min total)
- Root cause analysis, solution proposals, test planning
- Each agent builds on previous findings

### 4. Accessibility Scan Workflow ⭐ NEW

**Trigger:** `@appski accessibility`, `@appski a11y`, `@appski wcag`,
`@appski 508`, `@appski accessible`

- 3 sequential agents (25 min total)
- **Agent 1:** WCAG 2.1 AA Compliance Specialist (10 min)
  - Color contrast, keyboard navigation, screen readers
  - Focus management, semantic HTML, ARIA
- **Agent 2:** Automated Testing Strategist (8 min)
  - axe-core, Pa11y, Lighthouse CI integration
  - Test coverage for WCAG success criteria
- **Agent 3:** Remediation Planning Expert (7 min)
  - Prioritized action plan with effort estimates
  - Code examples and best practices
- **Output:** Comprehensive accessibility audit with remediation roadmap

## Test Scenarios

### Test 1: Accessibility Workflow (Recommended First Test)

1. Go to any Azure DevOps work item (e.g.,
   https://dev.azure.com/utrgv/PROJECT/_workitems/edit/XXXX)
2. Add comment: `@appski accessibility scan our application`
3. **Expected Results:**
   - Immediate comment: "🚀 Workflow Started: accessibility-scan (3 agents, ~25
     min)"
   - After 25 minutes: "✅ Workflow Complete" with full accessibility audit
   - Audit includes: WCAG violations, testing strategy, remediation plan

### Test 2: Help Message (No Intent)

1. Add comment: `@appski`
2. **Expected Results:**
   - Comment posted listing all available workflows with descriptions

### Test 3: Unknown Workflow

1. Add comment: `@appski do-something-unknown`
2. **Expected Results:**
   - Error message: "Unknown workflow" with list of available commands

### Test 4: Bug Investigation (Sequential Workflow)

1. Add comment:
   `@appski bug-investigation Users report login fails after password reset`
2. **Expected Results:**
   - "🚀 Workflow Started" comment
   - Agents run sequentially (one after another)
   - Final report includes root cause → solutions → test plan

### Test 5: Research (Parallel Workflow)

1. Add comment:
   `@appski research Modern authentication patterns for web applications`
2. **Expected Results:**
   - "🚀 Workflow Started" comment
   - 3 agents run simultaneously
   - Final report synthesizes all research findings

## Monitoring During Tests

### Watch Logs in Real-Time

```bash
journalctl --user -u opencode-chat-bridge -f
```

### Check for Errors

```bash
journalctl --user -u opencode-chat-bridge --since "10 minutes ago" | grep -i "error\|failed"
```

### See Workflow Activity

```bash
journalctl --user -u opencode-chat-bridge --since "10 minutes ago" | grep -i "workflow\|agent"
```

## Expected Behavior

### When Workflow Starts

- **Azure DevOps:** Comment posted with "🚀 Workflow Started: [name]"
- **Logs:** `Starting workflow: [workflow-id]`
- **Logs:** `Agent [N] started: [prompt preview]`

### During Execution (Parallel)

- **Logs:** Multiple "Agent completed" messages arriving simultaneously
- **No intermediate comments** (could add this as future feature)

### During Execution (Sequential)

- **Logs:** "Agent 1 completed" → "Agent 2 started" → "Agent 2 completed" → etc.
- Agents can reference previous agent outputs

### On Success

- **Azure DevOps:** Comment posted with "✅ Workflow Complete"
- **Content:** Full synthesis output from final agent
- **Logs:** `Workflow completed: [workflow-id]`

### On Failure

- **Azure DevOps:** Comment posted with "❌ Workflow Failed"
- **Content:** Error message with details
- **Logs:** Error stack trace

## Troubleshooting

### No Comments Posted to Azure DevOps

**Check:**

1. Azure DevOps PAT configured: `grep AZURE_DEVOPS_PAT .env`
2. Client initialization:
   `journalctl -u opencode-chat-bridge | grep "Azure DevOps"`
3. API errors: `journalctl -u opencode-chat-bridge | grep -i "azure.*error"`

**Common Issues:**

- PAT expired or missing "Work Items (Read & Write)" permission
- Wrong organization name in config
- Network connectivity to dev.azure.com

### Workflow Never Starts

**Check:**

1. Webhook received:
   `journalctl -u opencode-chat-bridge | grep "webhook.*received"`
2. Mention parsed: `journalctl -u opencode-chat-bridge | grep "mention.*bot"`
3. Intent extracted:
   `journalctl -u opencode-chat-bridge | grep "intent.*extracted"`

**Common Issues:**

- Bot not mentioned correctly (needs `@appski`)
- Webhook not configured in Azure DevOps
- Webhook credentials invalid

### Workflow Hangs or Times Out

**Check:**

1. Agent status: `journalctl -u opencode-chat-bridge | grep "agent.*status"`
2. OpenCode connection:
   `journalctl -u opencode-chat-bridge | grep -i "opencode"`
3. Session errors: `journalctl -u opencode-chat-bridge | grep "session.*error"`

**Common Issues:**

- OpenCode API down or rate limited
- Network timeout to OpenCode service
- Agent prompt too complex or model struggling

### Error Serialization Issues

**Fixed in this release:** Error objects now properly formatted

- Previously: `[object Object]`
- Now: Actual error message extracted from SSE events

## Next Steps After Testing

### High Priority

1. **Extract APP_URL from work item**
   - Currently placeholder is empty
   - Parse from description, custom fields, or project config
   - Required for meaningful accessibility audits

2. **Add workflow progress updates**
   - Post intermediate comments: "Agent 1/3 completed"
   - Helps users track long-running workflows

3. **Implement cancellation**
   - Comment `@appski cancel` stops workflow
   - Gracefully terminate agents and clean up

### Medium Priority

1. **Add more workflows:**
   - Security scan (OWASP, dependencies)
   - Performance profiling (Lighthouse, Core Web Vitals)
   - Documentation generation
   - Test coverage analysis

2. **Improve synthesis formatting:**
   - Use Azure DevOps markdown features
   - Expandable sections for long outputs
   - Tables, charts, checklists

3. **Workflow templates:**
   - User-defined workflows via config
   - Tag-based workflow selection

### Low Priority

1. **Metrics and monitoring:**
   - Track execution times, success rates
   - Identify common failure patterns

2. **Rate limiting:**
   - Prevent workflow spam

3. **Workflow queue:**
   - Handle multiple concurrent workflows

## Architecture Notes

### Key Files Modified

- `src/sessions/Session.ts` - Error serialization fix
- `src/webhooks/AzureDevOpsApiClient.ts` - NEW API client
- `src/config/index.ts` - Azure DevOps config
- `src/webhooks/routes.ts` - Results posting logic
- `src/orchestration/workflows/examples.ts` - Accessibility workflow

### Workflow Execution Flow

```
Azure DevOps Comment → Webhook → Parse Mention → Extract Intent
    ↓
Match Workflow → Create Agent Pool → Execute Strategy (Parallel/Sequential)
    ↓
Collect Agent Results → Synthesize Output → Post to Azure DevOps
```

### Placeholder Replacement

- `{{TOPIC}}` - User's request/intent
- `{{BUG_DESCRIPTION}}` - Full mention text
- `{{WORK_ITEM_ID}}` - Work item number
- `{{WORK_ITEM_URL}}` - Direct link
- `{{APP_URL}}` - Application URL (TODO: extract from work item)

## Git Status

**Commit:** `b1d6c92` - feat: add Azure DevOps results posting and accessibility
workflow **Status:** ✅ Pushed to remote (origin/main) **Branch:** main (up to
date with origin) **Clean:** No uncommitted changes or stashes

## Support

**Logs Location:**

```bash
journalctl --user -u opencode-chat-bridge
```

**Service Management:**

```bash
systemctl --user status opencode-chat-bridge
systemctl --user restart opencode-chat-bridge
systemctl --user stop opencode-chat-bridge
```

**Build & Deploy:**

```bash
npm run build
systemctl --user restart opencode-chat-bridge
```
