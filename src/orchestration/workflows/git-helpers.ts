/**
 * Git Workflow Integration Helpers
 *
 * These helpers provide reusable git workflow patterns for all workflows
 * that need to make code changes and create PRs.
 */

/**
 * Standard git setup prompt fragment
 * Use this at the start of any implementation task
 */
export const GIT_SETUP_PROMPT = `
## Git Workflow Setup

Before making any changes, follow these steps:

1. Navigate to project directory: \`cd {{PROJECT_PATH}}\`
2. Ensure you're on the latest develop branch:
   \`\`\`bash
   git checkout develop
   git pull origin develop
   \`\`\`
3. Create a feature branch:
   \`\`\`bash
   git checkout -b {{BRANCH_NAME}}
   \`\`\`
4. Verify you're on the new branch:
   \`\`\`bash
   git branch --show-current
   \`\`\`

Now you can proceed with making changes.
`;

/**
 * Standard git commit and PR creation prompt fragment
 * Use this at the end of any implementation task
 */
export const GIT_PR_PROMPT = `
## Git Commit and PR Creation

After making all changes:

1. Review what changed:
   \`\`\`bash
   git status
   git diff
   \`\`\`

2. Stage all changes:
   \`\`\`bash
   git add .
   \`\`\`

3. Commit with a clear message following conventional commits:
   \`\`\`bash
   git commit -m "{{COMMIT_TYPE}}: {{COMMIT_SUMMARY}}
   
   {{COMMIT_DETAILS}}
   
   Relates to: {{WORK_ITEM_URL}}"
   \`\`\`

4. Push to remote:
   \`\`\`bash
   git push origin {{BRANCH_NAME}}
   \`\`\`

5. Create PR using GitHub CLI:
   \`\`\`bash
   gh pr create \\
     --title "{{PR_TITLE}}" \\
     --body "\$(cat <<'EOF'
## Summary
{{PR_SUMMARY}}

## Changes Made
{{PR_CHANGES}}

## Testing Notes
{{PR_TESTING}}

## Related Work Items
- {{WORK_ITEM_URL}}

## Checklist
- [x] Code follows project style guidelines
- [x] Self-review completed
- [x] Changes tested locally
- [ ] Ready for code review

---
🤖 Automatically created by OpenCode AI Agent
EOF
)" \\
     --base develop
   \`\`\`

6. Capture and report the PR URL from the output

CRITICAL: 
- Always push to 'develop' branch (use --base develop)
- Never push directly to 'develop' - always use a feature branch
- If any git command fails, troubleshoot and retry
- Report the PR URL clearly at the end
`;

/**
 * Helper to generate conventional commit types
 */
export function getCommitType(workItemType: string, title: string): string {
  const titleLower = title.toLowerCase();

  if (titleLower.includes('bug') || titleLower.includes('fix')) {
    return 'fix';
  }
  if (titleLower.includes('test')) {
    return 'test';
  }
  if (titleLower.includes('doc')) {
    return 'docs';
  }
  if (titleLower.includes('refactor')) {
    return 'refactor';
  }
  if (titleLower.includes('style')) {
    return 'style';
  }
  if (titleLower.includes('perf')) {
    return 'perf';
  }
  if (titleLower.includes('chore')) {
    return 'chore';
  }

  // Default to 'feat' for features and enhancements
  return 'feat';
}

/**
 * Helper function to generate branch name from work item
 */
export function generateBranchName(workItemTitle: string, workItemId?: string): string {
  const sanitized = workItemTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50); // Limit length

  const prefix = workItemId ? `feature/${workItemId}` : 'feature';
  return `${prefix}-${sanitized}`;
}

/**
 * Create a complete implementation prompt with git workflow
 */
export function createImplementationPrompt(
  taskDescription: string,
  includeGitSetup: boolean = true,
  includeGitPR: boolean = false
): string {
  let prompt = '';

  if (includeGitSetup) {
    prompt += GIT_SETUP_PROMPT + '\n\n';
  }

  prompt += taskDescription + '\n\n';

  if (includeGitPR) {
    prompt += GIT_PR_PROMPT;
  }

  return prompt;
}

/**
 * Standard git context for workflow replacements
 */
export interface GitWorkflowContext {
  PROJECT_PATH: string;
  BRANCH_NAME: string;
  WORK_ITEM_URL: string;
  WORK_ITEM_TITLE: string;
  WORK_ITEM_DESCRIPTION: string;
  WORK_ITEM_ID?: string;
  COMMIT_TYPE: string;
  COMMIT_SUMMARY: string;
  PR_TITLE: string;
}

/**
 * Prepare standard git workflow context
 */
export function prepareGitWorkflowContext(
  workItemTitle: string,
  workItemDescription: string,
  workItemUrl: string,
  workItemId: string | undefined,
  projectPath: string
): GitWorkflowContext {
  const branchName = generateBranchName(workItemTitle, workItemId);
  const commitType = getCommitType('', workItemTitle);

  return {
    PROJECT_PATH: projectPath,
    BRANCH_NAME: branchName,
    WORK_ITEM_URL: workItemUrl,
    WORK_ITEM_TITLE: workItemTitle,
    WORK_ITEM_DESCRIPTION: workItemDescription,
    WORK_ITEM_ID: workItemId,
    COMMIT_TYPE: commitType,
    COMMIT_SUMMARY: workItemTitle,
    PR_TITLE: workItemTitle,
  };
}
