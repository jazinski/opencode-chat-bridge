import type { WorkflowDefinition, ExecutionStrategy } from '../types.js';
import { workflowEngine } from '../WorkflowEngine.js';
import { logger } from '@/utils/logger.js';

/**
 * Initialize and register all example workflows
 */
export function initializeWorkflows(): void {
  workflowEngine.registerWorkflow(researchWorkflow);
  workflowEngine.registerWorkflow(codeReviewWorkflow);
  workflowEngine.registerWorkflow(bugInvestigationWorkflow);
  workflowEngine.registerWorkflow(accessibilityScanWorkflow);
  logger.info('Registered 4 example workflows');
}

/**
 * Research workflow that demonstrates multi-agent collaboration
 *
 * Example usage:
 * @OpenCodeBot research authentication best practices for Node.js APIs
 *
 * This will:
 * 1. Agent A researches authentication best practices
 * 2. Agent B researches Node.js security patterns
 * 3. Agent C researches API security standards
 * 4. Synthesis agent combines findings into comprehensive report
 */
export const researchWorkflow: WorkflowDefinition = {
  id: 'research-workflow',
  name: 'Multi-Agent Research',
  description: 'Parallel research with cross-referencing and synthesis',
  strategy: 'parallel' as ExecutionStrategy,
  timeout: 15, // 15 minutes total
  tasks: [
    {
      id: 'research-primary',
      name: 'Primary Research Agent',
      prompt: `You are a primary research agent. Research the main topic thoroughly.
      
Topic: {{TOPIC}}

Provide:
1. Key concepts and definitions
2. Current best practices
3. Common pitfalls to avoid
4. Relevant examples
5. Recent developments (last 2 years)

Use web search extensively. Cite sources.`,
      timeout: 10,
    },
    {
      id: 'research-technical',
      name: 'Technical Deep Dive Agent',
      prompt: `You are a technical research agent. Focus on implementation details and technical considerations.

Topic: {{TOPIC}}

Provide:
1. Technical architecture patterns
2. Implementation considerations
3. Performance implications
4. Security concerns
5. Code examples and libraries

Use web search for latest information. Cite sources.`,
      timeout: 10,
    },
    {
      id: 'research-alternatives',
      name: 'Alternatives & Comparison Agent',
      prompt: `You are a comparative research agent. Research alternatives and trade-offs.

Topic: {{TOPIC}}

Provide:
1. Alternative approaches
2. Comparative analysis
3. Trade-offs and decision factors
4. Industry trends
5. Real-world case studies

Use web search to find current alternatives. Cite sources.`,
      timeout: 10,
    },
  ],
  synthesisPrompt: `You are a synthesis agent. Review the research from three specialized agents and create a comprehensive, actionable report.

Your goal:
1. Integrate findings from all three agents
2. Identify common themes and patterns
3. Resolve any contradictions
4. Provide clear, actionable recommendations
5. Create a structured executive summary

Format your response as:

# Executive Summary
[2-3 paragraph overview]

# Key Findings
[Bullet points of most important insights]

# Recommendations
[Numbered list of specific, actionable recommendations]

# Technical Implementation
[Practical guidance for implementation]

# Resources & References
[Compiled list of all cited sources]

Agent outputs follow below:`,
};

/**
 * Code review workflow for pull requests
 */
export const codeReviewWorkflow: WorkflowDefinition = {
  id: 'code-review-workflow',
  name: 'Multi-Perspective Code Review',
  description: 'Review code from security, performance, and maintainability perspectives',
  strategy: 'parallel' as ExecutionStrategy,
  timeout: 20,
  tasks: [
    {
      id: 'review-security',
      name: 'Security Review Agent',
      prompt: `You are a security-focused code reviewer. Analyze the code for security vulnerabilities.

Focus on:
1. Input validation and sanitization
2. Authentication and authorization
3. Data exposure and leaks
4. Injection vulnerabilities
5. Secure defaults and configurations
6. Dependency vulnerabilities

Provide specific line-by-line feedback with severity ratings.`,
      timeout: 15,
    },
    {
      id: 'review-performance',
      name: 'Performance Review Agent',
      prompt: `You are a performance-focused code reviewer. Analyze the code for performance issues.

Focus on:
1. Algorithmic complexity
2. Database query efficiency
3. Memory usage and leaks
4. Network calls and caching
5. Async/await patterns
6. Resource management

Provide specific optimization recommendations.`,
      timeout: 15,
    },
    {
      id: 'review-maintainability',
      name: 'Maintainability Review Agent',
      prompt: `You are a maintainability-focused code reviewer. Analyze code quality and maintainability.

Focus on:
1. Code organization and structure
2. Naming conventions
3. Documentation and comments
4. Error handling
5. Test coverage
6. Code duplication
7. Design patterns

Provide actionable improvement suggestions.`,
      timeout: 15,
    },
  ],
  synthesisPrompt: `You are a senior code reviewer. Synthesize feedback from three specialized reviewers (security, performance, maintainability).

Create a consolidated code review with:

# Overall Assessment
[High-level summary and recommendation: Approve / Request Changes / Reject]

# Critical Issues
[P0 - Must fix before merge]

# Important Issues  
[P1 - Should fix before merge]

# Suggestions
[P2 - Nice to have improvements]

# Positive Aspects
[What was done well]

Group related feedback and eliminate redundancy. Prioritize by impact.`,
};

/**
 * Bug investigation workflow
 */
export const bugInvestigationWorkflow: WorkflowDefinition = {
  id: 'bug-investigation-workflow',
  name: 'Systematic Bug Investigation',
  description: 'Multi-agent bug analysis and root cause identification',
  strategy: 'sequential' as ExecutionStrategy,
  timeout: 25,
  tasks: [
    {
      id: 'bug-reproduce',
      name: 'Reproduction Agent',
      prompt: `You are a bug reproduction specialist. Analyze the bug report and create reproducible steps.

Bug Report: {{BUG_DESCRIPTION}}

Tasks:
1. Identify the exact steps to reproduce
2. Determine affected versions/environments
3. Create minimal reproduction case
4. Document observed vs expected behavior

Be systematic and thorough.`,
      timeout: 8,
    },
    {
      id: 'bug-analyze',
      name: 'Root Cause Analysis Agent',
      prompt: `You are a root cause analysis expert. Given the reproduction steps, investigate the underlying cause.

Tasks:
1. Examine relevant code paths
2. Identify potential failure points
3. Check recent changes that might have introduced the bug
4. Analyze logs and stack traces
5. Determine root cause

Use code search and file analysis extensively.`,
      timeout: 10,
    },
    {
      id: 'bug-solution',
      name: 'Solution Design Agent',
      prompt: `You are a solution architect. Design a fix for the identified bug.

Tasks:
1. Propose solution approach
2. Identify files that need changes
3. Consider edge cases
4. Plan for testing
5. Assess impact on other components
6. Provide implementation guidance

Be specific and actionable.`,
      timeout: 7,
    },
  ],
  synthesisPrompt: `Create a comprehensive bug report and fix plan:

# Bug Summary
[Concise description]

# Root Cause
[Technical explanation]

# Proposed Solution
[Step-by-step fix plan]

# Testing Strategy
[How to verify the fix]

# Risk Assessment
[Potential impacts and mitigation]`,
};

/**
 * Accessibility scan workflow for WCAG compliance
 */
export const accessibilityScanWorkflow: WorkflowDefinition = {
  id: 'accessibility-scan-workflow',
  name: 'Accessibility Compliance Scan',
  description: 'Multi-agent accessibility audit with WCAG 2.1 AA compliance',
  strategy: 'sequential' as ExecutionStrategy,
  timeout: 25,
  tasks: [
    {
      id: 'wcag-compliance',
      name: 'WCAG Compliance Agent',
      prompt: `You are a WCAG 2.1 AA compliance specialist. Analyze the application for accessibility compliance.

Application: {{APP_URL}}
Work Item: {{WORK_ITEM_URL}}

Tasks:
1. Check WCAG 2.1 Level AA compliance
2. Identify violations by category:
   - Perceivable (text alternatives, captions, adaptable, distinguishable)
   - Operable (keyboard accessible, enough time, seizures, navigable)
   - Understandable (readable, predictable, input assistance)
   - Robust (compatible with assistive technologies)
3. Document each violation with:
   - Severity (Critical, Major, Minor)
   - WCAG success criterion violated
   - Location in the application
   - Impact on users with disabilities
4. Prioritize issues by user impact

Use web search to verify current WCAG 2.1 standards. If {{APP_URL}} is provided, analyze it directly.`,
      timeout: 10,
    },
    {
      id: 'automated-testing',
      name: 'Automated Testing Agent',
      prompt: `You are an automated accessibility testing specialist. Recommend and evaluate automated testing strategies.

Application: {{APP_URL}}
Work Item: {{WORK_ITEM_URL}}

Tasks:
1. Recommend automated testing tools:
   - axe-core (deque)
   - WAVE (WebAIM)
   - Lighthouse
   - Pa11y
   - NVDA/JAWS screen reader testing
2. Create test plan with specific test cases
3. Identify areas that require manual testing
4. Suggest CI/CD integration approaches
5. Provide code examples for automated tests

Use web search for latest tools and best practices.`,
      timeout: 8,
    },
    {
      id: 'remediation-plan',
      name: 'Remediation Planning Agent',
      prompt: `You are an accessibility remediation expert. Create a detailed remediation plan.

Application: {{APP_URL}}
Work Item: {{WORK_ITEM_URL}}

Tasks:
1. Prioritize issues by:
   - Legal compliance risk (Critical: P0)
   - User impact severity (High: P1, Medium: P2, Low: P3)
   - Remediation complexity
2. For each priority group, provide:
   - Specific implementation guidance
   - Code examples (HTML, CSS, ARIA, JavaScript)
   - Alternative approaches
   - Testing strategies
3. Estimate effort for each fix (hours/days)
4. Create phased rollout plan
5. Recommend ongoing compliance monitoring

Provide actionable, specific guidance that developers can implement immediately.`,
      timeout: 7,
    },
  ],
  synthesisPrompt: `Create a comprehensive accessibility audit report:

# Executive Summary
[High-level overview with total violation count by severity]

# WCAG Compliance Status
[Compliance percentage and key findings]

# Critical Issues (P0)
[Must-fix violations with legal implications]

# High Priority Issues (P1)
[Significant user impact violations]

# Medium/Low Priority Issues (P2-P3)
[Lesser violations and improvements]

# Automated Testing Strategy
[Tools, setup, and CI/CD integration]

# Remediation Roadmap
[Phased implementation plan with timelines]

# Code Examples
[Key remediation code samples]

# Ongoing Compliance
[Long-term monitoring and maintenance strategy]`,
};

/**
 * Get workflow by ID or intent
 */
export function getWorkflowForIntent(intent: string): WorkflowDefinition | null {
  const intentLower = intent.toLowerCase();

  // Accessibility scan workflow
  if (
    intentLower.includes('accessibility') ||
    intentLower.includes('a11y') ||
    intentLower.includes('wcag') ||
    intentLower.includes('508') ||
    intentLower.includes('accessible')
  ) {
    return accessibilityScanWorkflow;
  }

  if (intentLower.includes('research') || intentLower.includes('investigate')) {
    return researchWorkflow;
  }

  if (intentLower.includes('review') || intentLower.includes('code review')) {
    return codeReviewWorkflow;
  }

  if (intentLower.includes('bug') || intentLower.includes('issue') || intentLower.includes('fix')) {
    return bugInvestigationWorkflow;
  }

  return null;
}

/**
 * Replace placeholders in workflow tasks
 */
export function customizeWorkflow(
  workflow: WorkflowDefinition,
  replacements: Record<string, string>
): WorkflowDefinition {
  const customized: WorkflowDefinition = {
    ...workflow,
    tasks: workflow.tasks.map((task) => ({
      ...task,
      prompt: replacePlaceholders(task.prompt, replacements),
    })),
  };

  if (workflow.synthesisPrompt) {
    customized.synthesisPrompt = replacePlaceholders(workflow.synthesisPrompt, replacements);
  }

  return customized;
}

/**
 * Replace {{PLACEHOLDER}} patterns in text
 */
function replacePlaceholders(text: string, replacements: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(pattern, value);
  }
  return result;
}
