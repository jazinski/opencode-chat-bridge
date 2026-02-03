import type { WorkflowDefinition, ExecutionStrategy } from '../types.js';
import { GIT_SETUP_PROMPT, GIT_PR_PROMPT } from './git-helpers.js';

/**
 * Bug Fix Workflow with Git PR
 *
 * This workflow not only analyzes the bug but actually fixes it:
 * 1. Analyzes and reproduces the bug
 * 2. Identifies root cause
 * 3. Creates feature branch from develop
 * 4. Implements the fix
 * 5. Writes/updates tests
 * 6. Creates PR to develop
 */
export const bugFixWorkflow: WorkflowDefinition = {
  id: 'bug-fix-workflow',
  name: 'Autonomous Bug Fix with PR',
  description: 'Complete bug analysis, fix implementation, and PR creation',
  strategy: 'sequential' as ExecutionStrategy,
  timeout: 35,
  tasks: [
    {
      id: 'bug-analysis',
      name: 'Bug Analysis Agent',
      prompt: `You are a bug analysis specialist. Thoroughly investigate this bug.

Bug Report: {{WORK_ITEM_TITLE}}
Description: {{WORK_ITEM_DESCRIPTION}}
Project: {{PROJECT_PATH}}

Your mission:
1. Search the codebase to understand the context
2. Identify the exact location of the bug
3. Reproduce the issue if possible
4. Determine the root cause
5. Identify all affected code paths
6. Document your findings clearly

Use tools:
- \`grep\` to search for error messages, function names
- \`read\` to examine relevant files
- \`glob\` to find related files
- \`bash\` to run git log, git blame, etc.

Output format:

## Bug Location
[File paths and line numbers]

## Root Cause
[Technical explanation]

## Affected Areas
[All code that needs fixing]

## Reproduction Steps
[How to trigger the bug]

## Fix Strategy
[How to fix it]

Be thorough - a good analysis makes the fix easier!`,
      timeout: 10,
    },
    {
      id: 'implement-fix',
      name: 'Bug Fix Implementation Agent',
      prompt: `You are a bug fix specialist with git capabilities.

${GIT_SETUP_PROMPT}

## Bug Fix Task

Bug: {{WORK_ITEM_TITLE}}
Description: {{WORK_ITEM_DESCRIPTION}}

Analysis from previous agent:
{{PREVIOUS_OUTPUT}}

Your mission:
1. Follow git setup to create branch from develop
2. Implement the fix based on the analysis
3. Fix all affected code paths (not just symptoms!)
4. Add error handling if appropriate
5. Write or update tests to cover the bug
6. Verify the fix works (run tests, manual check)
7. Commit incrementally with clear messages

CRITICAL:
- Fix the root cause, not just symptoms
- Don't break other functionality
- Add regression tests
- Use proper error handling
- Follow existing code patterns

Tools available:
- \`bash\` for git, npm test, etc.
- \`read\` / \`edit\` / \`write\` for code changes
- \`grep\` / \`glob\` for searching

Actually implement the fix now. Make it happen!`,
      timeout: 20,
    },
    {
      id: 'create-fix-pr',
      name: 'Bug Fix PR Agent',
      prompt: `You are a PR creation agent for bug fixes.

${GIT_PR_PROMPT}

## Bug Fix PR

Bug: {{WORK_ITEM_TITLE}}
Work Item: {{WORK_ITEM_URL}}
Branch: {{BRANCH_NAME}}

Implementation summary:
{{PREVIOUS_OUTPUT}}

Your mission:
1. Navigate to {{PROJECT_PATH}}
2. Verify branch: git branch --show-current
3. Review changes: git status && git diff --stat
4. Stage any remaining changes: git add .
5. Commit if needed: git commit -m "fix: {{WORK_ITEM_TITLE}}"
6. Push: git push origin {{BRANCH_NAME}}
7. Create PR with gh CLI targeting develop:

\`\`\`bash
gh pr create \\
  --title "fix: {{WORK_ITEM_TITLE}}" \\
  --body "\$(cat <<'EOF'
## Bug Fix Summary
[Describe what was broken and how it's fixed]

## Root Cause
[Explain the root cause]

## Changes Made
- [List specific changes]

## Testing
- [x] Bug is no longer reproducible
- [x] Existing tests pass
- [x] Added regression test for this bug
- [ ] Manual testing completed (needs human review)

## Related Work Items
- {{WORK_ITEM_URL}}

---
🐛 Bug fix created by OpenCode AI Agent
EOF
)" \\
  --base develop
\`\`\`

8. Report the PR URL

Execute now and provide the PR link!`,
      timeout: 5,
    },
  ],
  synthesisPrompt: `# 🐛 Bug Fix Complete

## Bug Summary
[What was the bug]

## Root Cause
[Why it happened]

## Fix Implementation
[What was changed]

## Testing Results
[How it was verified]

## PR Details
- **Branch**: {{BRANCH_NAME}}
- **Target**: develop
- **PR URL**: [Extract from output]
- **Status**: Ready for Review

## Next Steps
1. Review the PR
2. Run manual tests to verify fix
3. Approve and merge to develop
4. Monitor for any side effects

---
✅ Bug has been fixed autonomously. Ready for review!`,
};
