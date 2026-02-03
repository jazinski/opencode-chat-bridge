import type { WorkflowDefinition, ExecutionStrategy } from '../types.js';
import { GIT_SETUP_PROMPT, GIT_PR_PROMPT } from './git-helpers.js';

/**
 * Git PR Workflow - Creates a feature branch from develop, makes changes, and creates a PR back to develop
 *
 * This workflow demonstrates autonomous agent operation with git:
 * 1. Pulls latest develop branch
 * 2. Creates a feature branch from develop
 * 3. Analyzes requirements and makes changes
 * 4. Commits and pushes to remote
 * 5. Creates a pull request targeting develop for review
 *
 * Example usage from Azure DevOps:
 * Create a work item with title: "Add hello world endpoint to API"
 * Tag it with: needs-ai-implementation
 *
 * The agent will:
 * - Create branch: feature/12345-add-hello-world-endpoint
 * - Add the endpoint code
 * - Write tests
 * - Create PR to develop with detailed description
 */
export const gitPrWorkflow: WorkflowDefinition = {
  id: 'git-pr-workflow',
  name: 'Git Branch & PR Creation Workflow',
  description:
    'Autonomous agent creates feature branch from develop, implements changes, and creates PR back to develop',
  strategy: 'sequential' as ExecutionStrategy,
  timeout: 30, // 30 minutes total
  tasks: [
    {
      id: 'analyze-requirements',
      name: 'Requirements Analysis Agent',
      prompt: `You are a requirements analysis agent. Analyze the requested change and create a detailed implementation plan.

Work Item: {{WORK_ITEM_TITLE}}
Description: {{WORK_ITEM_DESCRIPTION}}
Project Path: {{PROJECT_PATH}}

Tasks:
1. Read and understand the requirement fully
2. Search the codebase to understand current structure
3. Identify which files need to be created or modified
4. Determine the technical approach
5. List specific changes needed
6. Identify potential risks or edge cases
7. Create a step-by-step implementation plan

Use these tools effectively:
- \`read\` to examine existing files
- \`glob\` to find files by pattern
- \`grep\` to search for code patterns
- \`bash\` to run commands like \`ls\`, \`find\`, etc.

Output your analysis in this format:

## Summary
[Brief summary of what needs to be done]

## Current Codebase Analysis
[What you learned about the current code structure]

## Files to Modify/Create
- path/to/file1.ts - [what changes]
- path/to/file2.ts - [what changes]

## Implementation Steps
1. [Step 1]
2. [Step 2]
...

## Technical Considerations
- [Consideration 1]
- [Consideration 2]

## Testing Strategy
[How to test the changes]

Be thorough and specific.`,
      timeout: 10,
    },
    {
      id: 'implement-changes',
      name: 'Implementation Agent',
      prompt: `You are an implementation agent with full git and coding capabilities.

${GIT_SETUP_PROMPT}

## Implementation Task

Work Item: {{WORK_ITEM_TITLE}}
Description: {{WORK_ITEM_DESCRIPTION}}

Previous agent provided this analysis:
{{PREVIOUS_OUTPUT}}

Your mission:
1. Follow the git setup steps above to create your feature branch from develop
2. Implement ALL the changes identified in the analysis
3. Follow the existing code style and patterns in the codebase
4. Add appropriate error handling
5. Include inline comments for complex logic
6. Make sure the code compiles/runs without errors
7. Create appropriate test files if needed
8. Run tests to ensure nothing breaks

Tools at your disposal:
- \`bash\` - Run any command (git, npm, build tools, etc.)
- \`read\` - Read file contents
- \`edit\` - Modify existing files
- \`write\` - Create new files
- \`glob\` - Find files by pattern
- \`grep\` - Search code

CRITICAL RULES:
- Actually execute the git commands using the bash tool
- Make incremental commits as you go (git add + git commit)
- DO NOT push yet - that's the next agent's job
- Test your changes before finishing
- Work autonomously - don't ask for permission

Execute the implementation now. Make it happen!`,
      timeout: 15,
    },
    {
      id: 'finalize-and-pr',
      name: 'PR Creation Agent',
      prompt: `You are a PR creation agent. Finalize the changes and create a pull request to develop.

${GIT_PR_PROMPT}

## Context

Work Item: {{WORK_ITEM_TITLE}}
Description: {{WORK_ITEM_DESCRIPTION}}
Work Item URL: {{WORK_ITEM_URL}}
Branch: {{BRANCH_NAME}}

Previous implementation:
{{PREVIOUS_OUTPUT}}

Your mission:
1. Navigate to: cd {{PROJECT_PATH}}
2. Verify branch: git branch --show-current (should be {{BRANCH_NAME}})
3. Review changes: git status && git diff --stat
4. If there are unstaged changes, stage them: git add .
5. If there are staged changes, commit them with a good message
6. Push the branch: git push origin {{BRANCH_NAME}}
7. Create PR using the gh CLI command shown above
   - Make sure --base is set to "develop"
   - Include detailed PR description
   - Reference work item URL
8. Capture the PR URL from gh output

## PR Description Template

Fill this in based on what was implemented:

**Summary**: [1-2 sentences describing the change]

**Changes Made**:
- [Bullet list of specific changes]

**Testing Notes**:
- [How to test the changes]
- [What was verified]

**Related Work Items**:
- {{WORK_ITEM_URL}}

IMPORTANT:
- Use bash tool for all commands
- Target develop branch with --base develop
- Verify PR is created successfully
- Report the PR URL clearly

Execute autonomously and report the PR URL!`,
      timeout: 5,
    },
  ],
  synthesisPrompt: `Create a comprehensive summary of the autonomous implementation:

# 🎉 Autonomous Implementation Complete

## What Was Implemented
[Summarize the changes from all agents]

## Branch & PR Details
- **Branch**: {{BRANCH_NAME}}
- **Base Branch**: develop
- **PR URL**: [Extract from final agent output]
- **Status**: Ready for Review

## Files Changed
[List files that were modified/created]

## Key Implementation Details
[Important notes about the implementation]

## Testing Recommendations
[What the reviewer should test]

## Next Steps for Human Review
1. Review the PR (link above)
2. Run manual tests if needed
3. Approve and merge to develop if everything looks good
4. The changes will then be in develop for further testing

---
✅ The AI agent has completed the implementation autonomously. The code is ready for your review!`,
};
