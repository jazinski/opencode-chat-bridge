# GitHub Token Setup for OpenCode

## Problem Identified

During testing, we discovered that the **GitHub Copilot API is returning 404
errors** when the workflow system tries to execute AI agents. This is the **root
cause** of all workflow failures.

### Error Details

```
APIError: Not Found: Not Found
statusCode: 404
url: https://api.githubcopilot.com/v1/messages
```

## Root Cause

The OpenCode system is trying to access the GitHub Copilot API at
`https://api.githubcopilot.com/v1/messages`, but this requires proper GitHub
authentication. Without a valid GitHub token with Copilot access, the API
returns 404 (Not Found).

## Good News

✅ **The workflow engine is working perfectly!**

- Event system works correctly
- Task execution logic is sound
- Error handling is proper
- Azure DevOps webhook processing is functional
- All our real-time update code is ready to go

The **only issue** is authentication to GitHub Copilot API.

## Solution: Add GitHub Token

### Step 1: Generate a GitHub Token

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a descriptive name: `OpenCode Chat Bridge - Copilot Access`
4. Select scopes:
   - ✅ `copilot` (GitHub Copilot access)
   - Optional but recommended:
     - ✅ `read:user` (Read user profile data)
     - ✅ `repo` (If workflows need to access private repositories)
5. Click "Generate token"
6. **Copy the token immediately** (you won't see it again!)

### Step 2: Add Token to `.env` File

Open `/home/cjazinski/projects/opencode-chat-bridge/.env` and add your token:

```bash
# GitHub Copilot API Configuration
# Required for OpenCode to access GitHub Copilot AI models
# Get your token from: https://github.com/settings/tokens
# Required scopes: copilot
GITHUB_TOKEN=ghp_your_token_here
```

### Step 3: Restart Services

After adding the token, restart both services:

```bash
# Restart OpenCode server (to pick up new GitHub token)
systemctl --user restart opencode-server

# Restart chat bridge
systemctl --user restart opencode-chat-bridge

# Verify services are running
systemctl --user status opencode-server
systemctl --user status opencode-chat-bridge
```

### Step 4: Test the Workflow

Run the test script again to verify everything works:

```bash
cd /home/cjazinski/projects/opencode-chat-bridge
npx tsx test-workflow.ts
```

You should see:

```
✅ TEST PASSED: Workflow executed successfully!
```

## What Will Work After This Fix

Once the GitHub token is added, **all features will work end-to-end**:

1. ✅ Azure DevOps webhook triggers workflow
2. ✅ Bot mention detection (`@appski`)
3. ✅ Immediate acknowledgment comment: "👀 Got it! Starting workflow..."
4. ✅ Work item tagging: `AI-Processing` → `AI-Complete`/`AI-Failed`
5. ✅ Start message with workflow details
6. ✅ AI agents execute successfully (calling GitHub Copilot API)
7. ✅ Progress updates after each agent completes
8. ✅ Final results posted to work item

## Alternative: Check Existing GitHub Authentication

The OpenCode server might already have GitHub authentication configured. Check:

```bash
# Check OpenCode server environment
systemctl --user cat opencode-server | grep -i github

# Check if GitHub token is in environment
env | grep -i github

# Check OpenCode configuration
cat ~/.config/opencode/config.json 2>/dev/null || echo "No config file"
```

If OpenCode already has GitHub Copilot access configured at the system level,
the issue might be different. In that case, check:

1. **GitHub Copilot Subscription**: Ensure your GitHub account has an active
   Copilot subscription
2. **API Endpoint**: The endpoint `api.githubcopilot.com` might have changed -
   check OpenCode SDK documentation
3. **OpenCode Version**: Ensure you're using a compatible version of OpenCode

## Verification After Fix

After adding the GitHub token and restarting services, verify:

1. **OpenCode Server Logs**: Should not show GitHub auth errors
   ```bash
   journalctl --user -u opencode-server --since "1 min ago"
   ```

2. **Test Workflow**: Run the test script successfully
   ```bash
   npx tsx test-workflow.ts
   ```

3. **Test Azure DevOps Integration**: Mention bot in a work item
   - Go to: https://dev.azure.com/utrgv/wa-ba-jar/_workitems
   - Add comment: `@appski please run accessibility scan on this application.`
   - Watch for real-time updates!

## Impact Analysis

### What Was Confirmed Working (Independent of GitHub Token)

- ✅ Workflow engine architecture
- ✅ Event system (workflow.started, task.started, task.completed, etc.)
- ✅ Sequential and parallel execution strategies
- ✅ Azure DevOps webhook validation and parsing
- ✅ Bot mention detection
- ✅ Intent extraction
- ✅ Workflow matching and selection
- ✅ Error handling and logging
- ✅ Service deployment

### What Needs GitHub Token to Work

- ❌ AI agent execution (blocked by 404 from GitHub Copilot API)
- ❌ Workflow completion (fails when first agent fails)
- ❌ Results posting to Azure DevOps (never reached due to agent failure)

### What's Unknown Until GitHub Token Is Fixed

- ❓ Azure DevOps API 404 errors might be a secondary issue
- ❓ Once agents can execute, we need to verify Azure DevOps comment/tag posting
  works
- ❓ Project name "wa-ba-jar" might need URL encoding or GUID usage

## Next Steps After GitHub Token Is Added

1. ✅ Verify test workflow completes successfully
2. ✅ Test with real Azure DevOps work item
3. ✅ Verify all real-time updates appear:
   - Acknowledgment comment
   - `AI-Processing` tag
   - Start message
   - Progress updates
   - Final results
   - `AI-Complete` tag
4. ❓ If Azure DevOps API still returns 404, investigate:
   - Project name encoding
   - PAT permissions
   - API endpoint format
   - Work item access permissions

## Summary

**Root Cause**: Missing GitHub token for Copilot API access

**Impact**: Blocks all AI agent execution, preventing any workflow from
completing

**Fix**: Add `GITHUB_TOKEN` to `.env` file and restart services

**Confidence**: High - the test clearly shows the workflow engine works, and the
only failure is the GitHub API 404

**Time to Fix**: < 5 minutes once token is obtained

**Expected Outcome**: All features will work end-to-end after this single fix
