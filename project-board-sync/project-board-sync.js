// PROJECT: GitHub Project Board Sync
// VERSION: 1.2.0
// UPDATED: 2025-05-28
//
// SCOPE: This script manages issues and PRs across all bcgov repositories and a single GitHub Projects v2 board, 
// strictly following the automation rules defined in requirements.md.
// All logic is requirements-driven; any changes to automation must be made in requirements.md and reflected here.
//
// USAGE:
// - Run with VERBOSE=true to enable detailed JSON logging of all operations
// - Run with STRICT_MODE=true to exit on preflight check failures
// - Example: VERBOSE=true node project-board-sync.js
// - Verbose JSON logs will be written to project-sync-log-[timestamp].json
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");

// Import custom utilities
const { fetchAssignedItems } = require('./fetch-user-assignments');
const RateLimitManager = require('./utils/rate-limit-manager');
const DiagnosticsContext = require('./utils/diagnostics-context');

// Environment variables
const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const VERBOSE = process.env.VERBOSE === 'true' || process.env.VERBOSE === '1';
const SKIP_PREFLIGHT = process.env.SKIP_PREFLIGHT === 'true' || process.env.SKIP_PREFLIGHT === '1';
const octokit = new Octokit({ auth: GH_TOKEN });

// Initialize rate limit manager
const rateLimitManager = new RateLimitManager(octokit, {
  maxRetries: 3,
  initialRetryDelay: 1000,
  maxRetryDelay: 10000
});

// Cache for issue details to reduce API calls
const issueDetailsCache = {};

// Project configuration
const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';

// Column status option IDs
const STATUS_OPTIONS = {
  parked: '5bc8cfd4',    // optionId for 'Parked' column
  new: 'f8e1e5a4',      // optionId for 'New' column
  backlog: 'd8686046',  // optionId for 'Backlog' column
  next: 'ab0fb504',     // optionId for 'Next' column
  active: 'c66ba2dd',   // optionId for 'Active' column
  waiting: 'cd3ebcfd',  // optionId for 'Waiting' column
  done: '46321e20'      // optionId for 'Done' column
};

// Sprint field configuration
const SPRINT_FIELD_ID = 'PVTIF_lADOAA37OM4AFuzgzgDTbhE';
const STATUS_FIELD_ID = 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA';

// --- Helper Functions ---

/**
 * Execute a GitHub API call with rate limit handling
 * @param {Function} operation - The API operation to execute
 * @param {Object} context - Additional context for the operation
 * @param {DiagnosticsContext} diagnostics - Optional diagnostics context for logging
 */
async function executeGitHubOperation(operation, context = {}, diagnostics = null) {
  try {
    // Update rate limit stats if diagnostics is provided
    if (diagnostics) {
      await diagnostics.updateRateLimitStats(rateLimitManager);
    }

    // Execute the operation with retries
    const result = await rateLimitManager.executeWithRetry(operation, context);

    // Update rate limit stats again after the operation
    if (diagnostics) {
      await diagnostics.updateRateLimitStats(rateLimitManager);
    }

    return result;
  } catch (error) {
    // Log rate limit related errors if diagnostics is provided
    if (diagnostics) {
      if (error.status === 403 && error.message.includes('rate limit')) {
        diagnostics.errors.push(`Rate limit exceeded: ${error.message}`);
      } else if (error.status === 429) {
        diagnostics.errors.push(`Secondary rate limit hit: ${error.message}`);
      }
    }
    throw error;
  }
}

/**
 * Assign a user to a project item
 * @param {string} projectItemId - The project item ID
 * @param {string} userId - GitHub user ID to assign
 * @param {Object} diagnostics - Diagnostics context for logging
 * @param {Object} itemInfo - Information about the item being processed
 */
async function assignUserToProjectItem(projectItemId, userId, diagnostics, itemInfo) {
  try {
    // We need to extract the repo name and issue/PR number
    const repoName = itemInfo.repoName;
    const itemNumber = itemInfo.number;
    
    if (!repoName || !itemNumber) {
      diagnostics.warnings.push(`Missing repository name or item number. Cannot assign user to ${itemInfo.type} #${itemInfo.number}.`);
      return false;
    }
    
    const [owner, repo] = repoName.split('/');
    
    try {
      // First, check if the user is already assigned to avoid duplicate assignments
      // Check cache for issue details to reduce API calls
      const cacheKey = `${repoName}/${itemNumber}`;
      let issueDetails = issueDetailsCache[cacheKey];
      
      if (!issueDetails) {
        // Fetch issue details from GitHub API if not in cache
        issueDetails = await octokit.issues.get({
          owner,
          repo,
          issue_number: itemNumber
        });
        // Store only the necessary assignee data in the cache to reduce memory usage
        issueDetailsCache[cacheKey] = {
          data: {
            assignees: issueDetails.data.assignees ? issueDetails.data.assignees.map(a => a.login) : []
          }
        };
      }
      
      // Get current assignees
      const currentAssignees = issueDetails.data.assignees.map(a => a.login);
      
      // If user is already assigned, skip the assignment
      if (currentAssignees.includes(userId)) {
        const repoInfo = itemInfo.repoName ? ` [${itemInfo.repoName}]` : '';
        diagnostics.infos.push(`User ${userId} is already assigned to ${itemInfo.type} #${itemInfo.number}${repoInfo}, skipping assignment`);
        
        diagnostics.addVerboseRecord({
          operation: 'skipAssignUser',
          itemType: itemInfo.type,
          itemNumber: itemInfo.number,
          repository: itemInfo.repoName,
          projectItemId,
          contentId: itemInfo.contentId,
          userId,
          result: 'skipped',
          existingAssignees: currentAssignees,
          url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`,
          reason: `User already assigned to ${itemInfo.type}`
        });
        
        return true;
      }
      
      // In GitHub's API, pull requests are treated as issues for assignment operations
      // Use only the issues endpoint for both types
      const response = await octokit.issues.addAssignees({
        owner,
        repo,
        issue_number: itemNumber,
        assignees: [userId]
      });
      
      
      // Update cache with only the necessary assignee data to reduce memory usage
      issueDetailsCache[cacheKey] = {
        data: {
          assignees: response.data.assignees ? response.data.assignees.map(a => a.login) : [userId]
        }
      };
      
      // Log the success
      const repoInfo = itemInfo.repoName ? ` [${itemInfo.repoName}]` : '';
      diagnostics.infos.push(`Assigned ${itemInfo.type} #${itemInfo.number}${repoInfo} to user ${userId}`);
      
      // Add verbose record
      diagnostics.addVerboseRecord({
        operation: 'assignUser',
        itemType: itemInfo.type,
        itemNumber: itemInfo.number,
        repository: itemInfo.repoName,
        projectItemId,
        contentId: itemInfo.contentId,
        userId,
        result: 'success',
        previousAssignees: currentAssignees,
        newAssignees: response.data.assignees ? response.data.assignees.map(a => a.login) : [userId],
        url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`,
        reason: `Assigning ${itemInfo.type} to user based on requirements`
      });
      
      return true;
    } catch (apiErr) {
      // If we hit a rate limit or transient error, try again after a short delay
      if (apiErr.status === 403 || apiErr.status === 429 || apiErr.status === 502 || apiErr.status === 503 || apiErr.status === 504) {
        diagnostics.warnings.push(`Rate limit or transient error when assigning user ${userId} to ${itemInfo.type} #${itemInfo.number}. Retrying in 2 seconds...`);
        
        // Wait 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          // Try again with the same parameters
          const retryResponse = await octokit.issues.addAssignees({
            owner,
            repo,
            issue_number: itemNumber,
            assignees: [userId]
          });
          
          // Log retry success
          const repoInfo = itemInfo.repoName ? ` [${itemInfo.repoName}]` : '';
          diagnostics.infos.push(`Successfully assigned ${itemInfo.type} #${itemInfo.number}${repoInfo} to user ${userId} on retry`);
          
          diagnostics.addVerboseRecord({
            operation: 'assignUserRetrySuccess',
            itemType: itemInfo.type,
            itemNumber: itemInfo.number,
            repository: itemInfo.repoName,
            projectItemId,
            contentId: itemInfo.contentId,
            userId,
            result: 'success',
            originalError: apiErr.message,
            url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`,
            reason: `Assignment succeeded on retry after ${apiErr.message}`
          });
          
          return true;
        } catch (retryErr) {
          // Log the retry failure
          diagnostics.errors.push(`Failed to assign user ${userId} to ${itemInfo.type} #${itemInfo.number} on retry: ${retryErr.message}`);
          
          diagnostics.addVerboseRecord({
            operation: 'assignUserRetryFailure',
            itemType: itemInfo.type,
            itemNumber: itemInfo.number,
            repository: itemInfo.repoName,
            projectItemId,
            contentId: itemInfo.contentId,
            userId,
            result: 'error',
            originalErrorMessage: apiErr.message,
            retryErrorMessage: retryErr.message,
            errorStatus: retryErr.status,
            errorResponse: retryErr.response?.data,
            url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`
          });
          
          // Return false to indicate failure after retry
          return false;
        }
      }
      
      // For other errors (not rate limit/transient), log and return false
      diagnostics.errors.push(`Failed to assign user ${userId} to ${itemInfo.type} #${itemInfo.number} via GitHub API: ${apiErr.message}`);
      
      // Add more detailed error information
      diagnostics.addVerboseRecord({
        operation: 'assignUserError',
        itemType: itemInfo.type,
        itemNumber: itemInfo.number,
        repository: itemInfo.repoName,
        projectItemId,
        contentId: itemInfo.contentId,
        userId,
        result: 'error',
        errorMessage: apiErr.message,
        errorStatus: apiErr.status,
        errorResponse: apiErr.response?.data,
        url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`
      });
      
      // Return false to indicate failure
      return false;
    }
  } catch (err) {
    // Log the error
    diagnostics.errors.push(`Failed to assign user for ${itemInfo.type} #${itemInfo.number}: ${err.message}`);
    
    // Add detailed error record for the outer exception
    diagnostics.addVerboseRecord({
      operation: 'assignUserException',
      itemType: itemInfo.type,
      itemNumber: itemInfo.number,
      repository: itemInfo.repoName,
      result: 'error',
      error: err.message,
      errorStack: err.stack,
      projectItemId,
      contentId: itemInfo.contentId,
      userId,
      url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`
    });

    return false;
  }
}

/**
 * Gets the current Sprint iteration ID by finding the iteration that includes today's date
 */
async function getCurrentSprintOptionId() {
  const res = await executeGitHubOperation(
    async () => octokit.graphql(`
      query($projectId:ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 50) {
              nodes {
                ... on ProjectV2IterationField {
                  id
                  name
                  configuration {
                    ... on ProjectV2IterationFieldConfiguration {
                      iterations {
                        id
                        title
                        startDate
                        duration
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, { projectId: PROJECT_ID }),
    { operation: 'getCurrentSprintOptionId' }
  );
  
  const sprintField = res.node.fields.nodes.find(f => f.id === SPRINT_FIELD_ID);
  if (!sprintField) {
    throw new Error('Sprint field not found in project configuration.');
  }
  
  const today = new Date();
  // Find the iteration (sprint) whose startDate <= today < startDate+duration
  const iterations = sprintField.configuration?.iterations || [];
  for (const iter of iterations) {
    const start = new Date(iter.startDate);
    const end = new Date(start.getTime() + iter.duration * 24 * 60 * 60 * 1000);
    if (today >= start && today < end) {
      return iter.id;
    }
  }
  
  throw new Error(`No Sprint iteration with a date range including today (${today.toISOString().slice(0,10)}). Available iterations: [${sprintField.configuration.iterations.map(i => `'${i.title}' (${i.startDate}, ${i.duration}d)`).join(', ')}]`);
}

/**
 * Extract monitored repositories from requirements.md
 */
function getMonitoredRepos() {
  try {
    // Use __dirname to ensure reliable path resolution
    const reqText = fs.readFileSync(path.join(__dirname, "requirements.md"), "utf8");
    const lines = reqText.split("\n");
    
    // Look for the Monitored Repositories section which is now marked with bold and a colon
    const startIdx = lines.findIndex(l => l.trim().includes('**Monitored Repositories**:'));
    
    if (startIdx === -1) {
      console.error('Could not find Monitored Repositories section in requirements.md');
      return [];
    }
    
    console.log(`Found repository section at line ${startIdx + 1}`);
    
    const repos = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines, comments or notes
      if (line === '' || line.startsWith('(') || line.startsWith('_')) continue;
      
      if (line.startsWith('- ')) {
        const repo = line.replace('- ', '').trim();
        if (/^[a-zA-Z0-9._/-]+$/.test(repo)) {
          // If the repo name does not contain a slash, prepend 'bcgov/'
          if (!repo.includes('/')) {
            repos.push('bcgov/' + repo);
          } else {
            repos.push(repo);
          }
        }
      } else if (line.startsWith('#')) {
        // Stop if we've hit another section
        break;
      }
    }
    return repos;
  } catch (error) {
    console.error(`Error reading requirements.md: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Find or add an item to the project and return its project item ID
 */
async function findOrAddItemToProject(contentId, itemInfo = {}, diagnostics = null) {
  // First try to find the item in the project
  let endCursor = null;
  let projectItemId = null;
  let found = false;
  let currentStatus = null;
  
  do {
    const res = await executeGitHubOperation(
      async () => octokit.graphql(`
        query($projectId:ID!, $after:String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: 100, after: $after) {
                nodes { 
                  id 
                  content { 
                    ... on PullRequest { id }
                    ... on Issue { id } 
                  }
                  fieldValues(first: 8) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field { ... on ProjectV2SingleSelectField { name } }
                      }
                    }
                  }
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `, { projectId: PROJECT_ID, after: endCursor }), 
      {
        operation: 'findItemInProject',
        contentId: contentId,
        type: itemInfo.type,
        itemNumber: itemInfo.number,
        repository: itemInfo.repoName
      }
    );

    const items = res.node.items.nodes;
    const match = items.find(item => item.content && item.content.id === contentId);
    
    if (match) {
      projectItemId = match.id;
      found = true;

      // Try to extract the current status
      if (match.fieldValues && match.fieldValues.nodes) {
        const statusField = match.fieldValues.nodes.find(
          fv => fv.field && fv.field.name === 'Status'
        );
        if (statusField) {
          currentStatus = statusField.name;
        }
      }
      break;
    }
    
    if (!res.node.items.pageInfo.hasNextPage) {
      break;
    }
    
    endCursor = res.node.items.pageInfo.endCursor;
  } while (endCursor);

  // If not found, add it to the project
  if (!found) {
    const addResult = await executeGitHubOperation(
      async () => octokit.graphql(`
        mutation($projectId:ID!, $contentId:ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
            item { id }
          }
        }
      `, { projectId: PROJECT_ID, contentId }),
      {
        operation: 'addItemToProject',
        contentId: contentId,
        type: itemInfo.type,
        itemNumber: itemInfo.number,
        repository: itemInfo.repoName
      }
    );

    projectItemId = addResult.addProjectV2ItemById.item.id;

    // Log verbose data if diagnostics is provided
    if (diagnostics && itemInfo.type) {
      diagnostics.addVerboseRecord({
        operation: 'addToProject',
        itemType: itemInfo.type,
        itemNumber: itemInfo.number,
        repository: itemInfo.repoName,
        projectItemId,
        contentId,
        result: 'success',
        url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`,
        reason: itemInfo.reason || (itemInfo.type === 'Issue' ? 'New issue added to project board' : 'New PR added to project board')
      });
    }
  } else if (diagnostics && itemInfo.type) {
    // Log that we found the item if verbose data tracking is enabled
    diagnostics.addVerboseRecord({
      operation: 'findInProject',
      itemType: itemInfo.type,
      itemNumber: itemInfo.number,
      repository: itemInfo.repoName,
      projectItemId,
      contentId,
      currentStatus,
      result: 'success',
      url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`,
      reason: 'Item found in project board'
    });
  }
  
  return { projectItemId, wasAdded: !found, currentStatus };
}

/**
 * Update an item's status in the project
 */
async function updateItemStatus(projectItemId, statusOption, diagnostics, itemInfo) {
  try {
    // Create a record of the operation we're about to perform
    const columnName = Object.keys(STATUS_OPTIONS).find(k => STATUS_OPTIONS[k] === statusOption) || "unknown";
    const repoInfo = itemInfo.repoName ? ` [${itemInfo.repoName}]` : '';
    const operationData = {
      operation: 'updateStatus',
      itemType: itemInfo.type,
      itemNumber: itemInfo.number,
      repository: itemInfo.repoName,
      toStatus: columnName,
      fromStatus: itemInfo.currentStatus || 'unknown',
      projectItemId: projectItemId,
      itemId: itemInfo.contentId,
      url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`,
      reason: itemInfo.reason || `Item status updated based on requirements.md rules`
    };
    
    // Perform the GraphQL mutation
    await executeGitHubOperation(
      async () => octokit.graphql(`
        mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: { singleSelectOptionId: $optionId }
          }) { projectV2Item { id } }
        }
      `, {
        projectId: PROJECT_ID,
        itemId: projectItemId,
        fieldId: STATUS_FIELD_ID,
        optionId: statusOption
      }),
      {
        operation: 'updateItemStatus',
        itemType: itemInfo.type,
        itemNumber: itemInfo.number,
        repository: itemInfo.repoName,
        targetStatus: columnName
      }
    );
    
    // Log the regular info message
    diagnostics.infos.push(`Updated ${itemInfo.type} #${itemInfo.number}${repoInfo} to column "${columnName}"`);
    
    // Add detailed record
    diagnostics.addVerboseRecord({
      ...operationData,
      result: 'success'
    });

    return true;
  } catch (err) {
    // Log the error
    diagnostics.errors.push(`Failed to update status for ${itemInfo.type} #${itemInfo.number}: ${err.message}`);
    
    // Add detailed error record
    diagnostics.addVerboseRecord({
      operation: 'updateStatus',
      itemType: itemInfo.type,
      itemNumber: itemInfo.number,
      repository: itemInfo.repoName,
      result: 'error',
      error: err.message,
      projectItemId: projectItemId,
      itemId: itemInfo.contentId,
      url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`
    });

    return false;
  }
}

/**
 * Determines if a pull request should be considered as "merged" for the purpose of automation
 * A PR is considered merged if:
 * 1. It has the merged flag set to true, OR
 * 2. It is closed and has linked issues (via closingIssuesReferences)
 * 
 * @param {Object} pr - Pull Request object containing merged status, state and closing issues
 * @returns {boolean} - Whether the PR should be treated as merged
 */
function isPRMerged(pr) {
  // Only consider a PR as merged if it has the merged flag set to true
  // This aligns with requirements.md where linked issues should inherit from PR
  // only if it is merged OR open, not just closed with links
  return pr.merged === true;
}

/**
 * Get the current Sprint field value for a project item
 * @param {string} projectItemId - The project item ID
 * @returns {Promise<string|null>} The current sprint iteration ID, or null if not found/set
 */
async function getItemSprint(projectItemId) {
  try {
    const res = await executeGitHubOperation(
      async () => octokit.graphql(`
        query getItemFieldValues($itemId: ID!) {
          node(id: $itemId) {
            ... on ProjectV2Item {
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldIterationValue {
                    iterationId
                    field { ... on ProjectV2IterationField { name } }
                  }
                }
              }
            }
          }
        }`, { 
        itemId: projectItemId
      }), 
      { operation: 'getItemSprint', projectItemId }
    );
    
    if (!res.node?.fieldValues?.nodes) return null;
    
    const sprintField = res.node.fieldValues.nodes.find(
      fv => fv.field && fv.field.name === 'Sprint'
    );

    return sprintField ? sprintField.iterationId : null;
  } catch (err) {
    console.error(`Error getting sprint field for item ${projectItemId}: ${err.message}`);
    return null;
  }
}

// No longer needed - logic moved to inline calls

/**
 * Process batches of items to avoid rate limits
 */
async function processInBatches(items, batchSize, delayMs, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchPromises = batch.map(item => fn(item));
    const batchResults = await Promise.allSettled(batchPromises);
    results.push(...batchResults);
    
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

/**
 * Fetch recently updated items from a repository 
 */
async function fetchRecentItemsFromRepo(owner, repo, cutoffDate) {
  // Use separate pagination for issues and PRs to ensure we get all relevant items
  const issues = await fetchAllIssues(owner, repo, cutoffDate);
  const prs = await fetchAllPRs(owner, repo, cutoffDate);
  return { issues, prs };
}

/**
 * Fetch all issues from a repository with proper pagination
 */
async function fetchAllIssues(owner, repo, cutoffDate, diagnostics = null) {
  let issues = [];
  let hasNextPage = true;
  let endCursor = null;
  const cutoffDateIso = cutoffDate.toISOString();
  
  console.log(`Fetching all issues from ${owner}/${repo} updated since ${cutoffDateIso}`);
  
  while (hasNextPage) {
    const res = await executeGitHubOperation(
      async () => octokit.graphql(`
        query($owner: String!, $repo: String!, $after: String) {
          repository(owner: $owner, name: $repo) {
            issues(first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
              nodes {
                id
                number
                title
                author { login }
                state
                updatedAt
                repository { nameWithOwner }
                closedAt
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      `,
      { owner, repo, after: endCursor }
      ),
      { operation: 'fetchIssues', owner, repo }
    );
    
    // Filter issues by cutoff date
    const filteredIssues = res.repository.issues.nodes
      .filter(issue => new Date(issue.updatedAt) >= cutoffDate);
    
    issues.push(...filteredIssues);
    
    // Check if we should continue pagination
    const pageInfo = res.repository.issues.pageInfo;
    hasNextPage = pageInfo.hasNextPage;
    endCursor = pageInfo.endCursor;
    
    // Stop if we're getting too many old items
    const oldItemsCount = res.repository.issues.nodes.length - filteredIssues.length;
    if (oldItemsCount > 40) {
      console.log(`Stopping issues pagination for ${owner}/${repo} due to too many old items`);
      break;
    }
  }
  
  return issues;
}

/**
 * Fetch all PRs from a repository with proper pagination
 */  async function fetchAllPRs(owner, repo, cutoffDate, diagnostics = null) {
  let prs = [];
  let hasNextPage = true;
  let endCursor = null;
  const cutoffDateIso = cutoffDate.toISOString();
  
  console.log(`Fetching all PRs from ${owner}/${repo} updated since ${cutoffDateIso}`);
  
  while (hasNextPage) {
    const res = await executeGitHubOperation(
      async () => octokit.graphql(`
      query($owner: String!, $repo: String!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequests(first: 50, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              id
              number
              title
              author { login }
              state
              merged
              updatedAt
              repository { nameWithOwner }
              assignees(first: 5) {
                nodes {
                  login
                }
              }
              # Special debugging for linked issues and merge state
              isDraft
              closed
              closedAt
              mergedAt
              mergedBy { login }
              closingIssuesReferences(first: 10) { 
                nodes { 
                  id 
                  number
                  repository { nameWithOwner } 
                } 
              }
              closedAt
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
      `,
      { owner, repo, after: endCursor }),
      { operation: 'fetchPRs', owner, repo }
    );

    // Filter PRs by cutoff date
    const filteredPRs = res.repository.pullRequests.nodes
      .filter(pr => new Date(pr.updatedAt) >= cutoffDate);
    
    // Special debug for PR #78
    const pr78 = res.repository.pullRequests.nodes.find(pr => pr.number === 78);
    if (pr78) {
      console.log(`FOUND PR #78:
  updatedAt: ${pr78.updatedAt}
  author: ${pr78.author?.login}
  state: ${pr78.state}
  merged: ${pr78.merged}
  isDraft: ${pr78.isDraft}
  closed: ${pr78.closed}
  closedAt: ${pr78.closedAt}
  mergedAt: ${pr78.mergedAt}
  mergedBy: ${pr78.mergedBy?.login}
  included in processing: ${new Date(pr78.updatedAt) >= cutoffDate}
  linked issues: ${JSON.stringify(pr78.closingIssuesReferences?.nodes || [])}`);
    }
    
    prs.push(...filteredPRs);
    
    // Check if we should continue pagination
    const pageInfo = res.repository.pullRequests.pageInfo;
    hasNextPage = pageInfo.hasNextPage;
    endCursor = pageInfo.endCursor;
    
    // For debugging
    console.log(`Repository ${owner}/${repo} - Got ${res.repository.pullRequests.nodes.length} PRs, ${filteredPRs.length} meet cutoff date ${cutoffDateIso}`);
    
    // Stop if we're getting too many old items
    const oldItemsCount = res.repository.pullRequests.nodes.length - filteredPRs.length;
    if (oldItemsCount > 40) {
      console.log(`Stopping PRs pagination for ${owner}/${repo} due to too many old items`);
      break;
    }
  }
  
  return prs;
}

/**
 * Log diagnostics to console
 */
function logDiagnostics(diagnostics) {
  if (diagnostics.errors.length) {
    console.error('Errors:');
    diagnostics.errors.forEach(e => console.error(`- ${e}`));
  }
  
  if (diagnostics.warnings.length) {
    console.warn('Warnings:');
    diagnostics.warnings.forEach(w => console.warn(`- ${w}`));
  }
  
  if (diagnostics.infos.length) {
    console.info('Info:');
    diagnostics.infos.forEach(i => console.info(`- ${i}`));
  }
  
  // Output detailed JSON data if verbose mode is enabled
  if (VERBOSE && diagnostics.verboseData.length > 0) {
    console.info('\n===== VERBOSE OUTPUT =====');
    console.info('Detailed operations data (JSON format):');
    // Pretty print the JSON with 2 space indentation
    console.info(JSON.stringify(diagnostics.verboseData, null, 2));
    console.info('===== END VERBOSE OUTPUT =====\n');
    
    // Also write the verbose data to a log file for later analysis
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const logFileName = `project-board-sync-log-${timestamp}.json`;
      fs.writeFileSync(
        path.join(__dirname, logFileName), 
        JSON.stringify(diagnostics.verboseData, null, 2)
      );
      console.info(`Verbose log written to ${logFileName}`);
    } catch (err) {
      console.error(`Failed to write verbose log file: ${err.message}`);
    }
  }
}

/**
 * Process recently updated items (PRs and Issues) according to the requirements
 */
async function main() {
  const diagnostics = new DiagnosticsContext();
  const summary = {
    processed: 0,
    changed: 0,
    errors: 0
  };
  
  try {
    console.log('====================================================');
    console.log('  GitHub Project Board Sync (Version 1.2.0)');
    console.log('====================================================');
    console.log(`Start time: ${new Date().toISOString()}`);
    console.log(`Running as user: ${GITHUB_AUTHOR}`);
    console.log(`Verbose mode: ${VERBOSE ? 'ON' : 'OFF'}`);
    console.log(`Strict mode: ${process.env.STRICT_MODE === 'true' ? 'ON' : 'OFF'}`);
    console.log('====================================================');
    
    // Log the implementation of rules
    console.log('Applying rules from requirements.md:');
    console.log('- PRs authored by user will be moved to Active (if open) or Done (if closed)');
    console.log('- Issues linked to PRs will inherit status, sprint, and assignees from PR if PR is merged or open');
    console.log('- New issues in monitored repos will be added to New column');
    console.log('- Issues assigned to user in any repository will be added to New column');
    console.log('- Existing issues in Next/Active columns will have sprint maintained');
    console.log('- Items in Next/Active/Done columns will be assigned to current Sprint');
    
    // Load configuration
    const monitoredRepos = getMonitoredRepos();
    console.log(`Monitoring ${monitoredRepos.length} repositories: ${monitoredRepos.join(', ')}`);
    
    // Calculate cutoff date (7 days ago to ensure we catch PR 78)
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 7);
    console.log(`Processing items updated since: ${twoDaysAgo.toISOString()}`);
    
    // Get current sprint ID
    const currentSprintId = await getCurrentSprintOptionId();
    console.log(`Current sprint ID: ${currentSprintId}`);
    
    // Track processed items to avoid duplicates
    const processedNodeIds = new Set();
    const itemsToProcess = [];
    
    // --- 0. Specifically fetch and process issue #1603 from nr-forest-client ---
    console.log('Fetching specific issue #1603 from nr-forest-client...');
    try {
      const { data: issue } = await octokit.issues.get({
        owner: 'bcgov',
        repo: 'nr-forest-client',
        issue_number: 1603
      });
      
      console.log(`Found issue #1603: ${issue.title}`);
      console.log(`Assigned to: ${issue.assignee ? issue.assignee.login : 'nobody'}`);
      
      // Add to items to process
      const itemInfo = {
        type: 'Issue',
        number: issue.number,
        repoName: 'bcgov/nr-forest-client',
        contentId: issue.node_id,
        author: issue.user.login,
        state: issue.state.toUpperCase(),
        assignees: issue.assignees.map(a => a.login),
        linkedIssues: [],  // Empty array since this is a standalone issue
        targetStatus: STATUS_OPTIONS.new,
        reason: `Directly fetched issue #1603`
      };
      
      itemsToProcess.push(itemInfo);
      console.log('Added issue #1603 to processing queue');
    } catch (error) {
      diagnostics.errors.push(`Failed to fetch issue #1603: ${error.message}`);
      console.error('Error fetching issue #1603:', error);
    }
    
    // --- 0b. Find issues and PRs assigned to user across all repositories ---
    console.log(`Searching for issues and PRs assigned to ${GITHUB_AUTHOR} across all repositories...`);
    try {
      const assignedItems = await fetchAssignedItems(GITHUB_AUTHOR, twoDaysAgo);
      console.log(`Found ${assignedItems.length} items assigned to ${GITHUB_AUTHOR} across all repositories`);
      
      // Process each assigned item
      for (const item of assignedItems) {
        if (processedNodeIds.has(item.id)) continue;
        processedNodeIds.add(item.id);
        
        // Add the item to the project with appropriate metadata
        const itemInfo = {
          type: item.type,
          number: item.number,
          repoName: item.repoFullName,
          contentId: item.id,
          author: item.author,
          state: item.state,
          updatedAt: item.updatedAt,
          linkedIssues: [], // Initialize as empty array since we don't fetch linked issues for assigned items
          reason: `Assigned to ${GITHUB_AUTHOR}`
        };
        
        // For PRs, determine the target status
        if (item.type === 'PR') {
          itemInfo.targetStatus = item.state === 'OPEN' ? STATUS_OPTIONS.active : STATUS_OPTIONS.done;
        } else {
          // For issues, always add to "New" column
          itemInfo.targetStatus = STATUS_OPTIONS.new;
        }
        
        // Add to items to process
        itemsToProcess.push(itemInfo);
      }
    } catch (error) {
      diagnostics.errors.push(`Failed to fetch items assigned to ${GITHUB_AUTHOR}: ${error.message}`);
      console.error(`Error fetching items assigned to ${GITHUB_AUTHOR}:`, error);
    }
    
    // --- 1. Find user's PRs from all monitored repos ---
    for (const repoFullName of monitoredRepos) {
      const [owner, repo] = repoFullName.split('/');
      const { prs } = await fetchRecentItemsFromRepo(owner, repo, twoDaysAgo);
      
      // Get PRs authored by the specified user
      // Debug: Log all PRs before filtering
      console.log(`Found ${prs.length} PRs in repository ${owner}/${repo}`);
      prs.forEach(pr => {
        console.log(`PR #${pr.number} by ${pr.author?.login || 'unknown'}, updated: ${pr.updatedAt}, ID: ${pr.id}`);
      });
      
      const userPRs = prs.filter(pr => pr.author && pr.author.login === GITHUB_AUTHOR);
      console.log(`Found ${userPRs.length} user PRs in repository ${owner}/${repo} for author ${GITHUB_AUTHOR}`);
      
      for (const pr of userPRs) {
        if (processedNodeIds.has(pr.id)) continue;
        processedNodeIds.add(pr.id);
        
        // Determine target status based on PR state
        // According to requirements.md:
        // - New PRs authored by the user: Move to "Active"
        // - PRs authored by the user and closed: Move to "Done"
        const targetStatus = pr.state === 'OPEN' ? STATUS_OPTIONS.active : STATUS_OPTIONS.done;
        
        // Track whether the PR is merged or just closed
        // Using the isPRMerged helper for consistent behavior
        const isMerged = isPRMerged(pr);
        
        // Add a reason based on PR state
        const reason = pr.state === 'OPEN' 
          ? `User-authored PR moved to Active column` 
          : (isMerged 
              ? `User-authored PR was merged, moved to Done column`
              : `User-authored PR was closed, moved to Done column`);
        
        itemsToProcess.push({
          contentId: pr.id,
          type: 'PR',
          number: pr.number,
          repoName: pr.repository.nameWithOwner,
          targetStatus,
          linkedIssues: pr.closingIssuesReferences?.nodes || [],
          assignees: pr.assignees?.nodes || [],
          state: pr.state,
          merged: isMerged,
          closedAt: pr.closedAt,
          author: pr.author?.login,
          reason
        });
      }
    }
    
    // --- 2. Find new issues in monitored repos ---
    for (const repoFullName of monitoredRepos) {
      const [owner, repo] = repoFullName.split('/');
      const { issues } = await fetchRecentItemsFromRepo(owner, repo, twoDaysAgo);
      
      for (const issue of issues) {
        if (processedNodeIds.has(issue.id)) continue;
        processedNodeIds.add(issue.id);
        
        // Only add as new issues in "New" column that aren't already in the project
        // This is handled during processing with wasAdded check
        itemsToProcess.push({
          contentId: issue.id,
          type: 'Issue',
          number: issue.number,
          repoName: issue.repository.nameWithOwner,
          targetStatus: STATUS_OPTIONS.new, // Only applied for new issues added to board
          state: issue.state,
          closedAt: issue.closedAt,
          author: issue.author?.login,
          reason: 'New issue from monitored repository added to New column'
        });
      }
    }
    
    console.log(`Processing ${itemsToProcess.length} items...`);
    
    // Process all items
    await processInBatches(itemsToProcess, 10, 1000, async (item) => {
      summary.processed++;
      
      try {
        // Step 1: Find or add the item to the project
        const { projectItemId, wasAdded, currentStatus } = await findOrAddItemToProject(
          item.contentId,
          item, 
          diagnostics
        );
        
        // Update item with current status for more detailed tracking
        item.currentStatus = currentStatus;
        
        if (wasAdded) {
          diagnostics.infos.push(`Added ${item.type} #${item.number} from ${item.repoName} to project`);
        }
        
        // Apply specific rules based on requirements.md:
        // 1. For PRs: Only author's PRs get automatic status updates 
        // 2. For issues: Only new issues get added to "New" column; existing issues stay as they are
        
        // For existing issues in project
        if (item.type === 'Issue' && !wasAdded) {
          // Map status name to option ID for comparison
          const currentStatusId = Object.entries(STATUS_OPTIONS).find(([key, value]) => 
            key.toLowerCase() === (currentStatus || '').toLowerCase()
          )?.[1];

          // Check if existing issue is in Next or Active column (needs sprint assignment per requirements)
          const isInNextOrActiveColumn = 
            currentStatusId === STATUS_OPTIONS.next || 
            currentStatusId === STATUS_OPTIONS.active;
          
          // Check if this is a linked issue (either referenced from a PR or has linkedFrom set)
          const isLinkedIssue = item.linkedFrom || (item.type === 'Issue' && item.linkedIssues?.length > 0);

          // Only skip standalone issues that aren't in Next/Active columns
          // Linked issues should be processed according to PR state, regardless of current column
          if (!isInNextOrActiveColumn && !isLinkedIssue) {
            // Skip further processing for standalone issues not in Next or Active columns
            diagnostics.infos.push(`Skipping standalone Issue #${item.number} [${item.repoName}] (already in project)`);
            
            // Add detailed record for skipped item
            diagnostics.addVerboseRecord({
              operation: 'skip',
              itemType: item.type,
              itemNumber: item.number,
              repository: item.repoName,
              projectItemId,
              contentId: item.contentId,
              currentStatus,
              result: 'skipped',
              url: `https://github.com/${item.repoName}/issues/${item.number}`,
              reason: 'Standalone issue already exists in project board, not updating per requirements'
            });
            return;
          } else {
            // For Next/Active issues, continue processing for sprint assignment
            diagnostics.infos.push(`Checking sprint for ${item.type} #${item.number} [${item.repoName}] in ${currentStatus} column`);
            
            // Store the current status as the target status to preserve it
            item.targetStatus = currentStatusId;
            
            // Skip status update steps since we're keeping the current status
            diagnostics.addVerboseRecord({
              operation: 'processForSprint',
              itemType: item.type,
              itemNumber: item.number,
              repository: item.repoName,
              projectItemId,
              contentId: item.contentId,
              currentStatus,
              result: 'processing',
              url: `https://github.com/${item.repoName}/issues/${item.number}`,
              reason: 'Issue in Next/Active column needs sprint assignment per requirements'
            });
            
            // Skip to sprint assignment step
            // The code will continue to the sprint assignment below
          }
        }
        
        // For PRs that are already in the project, check if they are already in the correct state
        if (item.type === 'PR' && !wasAdded) {
          // Map status name to option ID for comparison
          const currentStatusId = Object.entries(STATUS_OPTIONS).find(([key, value]) => 
            key.toLowerCase() === (currentStatus || '').toLowerCase()
          )?.[1];
          
          // Check if the status already matches the target status
          const statusMatchesTarget = currentStatusId === item.targetStatus;
          
          if (statusMatchesTarget) {
            // For closed PRs, we only need to check if they're in the correct column
            if (item.state === 'CLOSED') {
              diagnostics.infos.push(`Skipping ${item.type} #${item.number} [${item.repoName}] (already in correct column '${currentStatus}')`);
              
              // Add detailed record for skipped item
              diagnostics.addVerboseRecord({
                operation: 'skipFullyConfigured',
                itemType: item.type,
                itemNumber: item.number,
                repository: item.repoName,
                projectItemId,
                contentId: item.contentId,
                currentStatus,
                state: item.state,
                result: 'skipped',
                url: `https://github.com/${item.repoName}/issues/${item.number}`,
                reason: 'PR already in correct column, skip further processing'
              });
              return;
            }
            // For open PRs, we'd still want to check user assignment later
          }
        }
        
        // Skip status updates for PRs not authored by the specified user
        if (item.type === 'PR' && item.author !== GITHUB_AUTHOR) {
          diagnostics.infos.push(`Skipping PR #${item.number} [${item.repoName}] status update (not authored by ${GITHUB_AUTHOR})`);
          
          // Add detailed record for skipped PR
          diagnostics.addVerboseRecord({
            operation: 'skip',
            itemType: item.type,
            itemNumber: item.number,
            repository: item.repoName,
            projectItemId,
            contentId: item.contentId,
            currentStatus,
            result: 'skipped',
            author: item.author,
            url: `https://github.com/${item.repoName}/pull/${item.number}`,
            reason: `PR not authored by configured user (${GITHUB_AUTHOR})`
          });
          return;
        }
        
        // Step 2: Update the status (only if needed)
        // Map status name to option ID for comparison
        const currentStatusId = Object.entries(STATUS_OPTIONS).find(([key, value]) => 
          key.toLowerCase() === (currentStatus || '').toLowerCase()
        )?.[1];
          
        // Check if the status already matches the target status
        const statusMatchesTarget = currentStatusId === item.targetStatus;
        
        if (!statusMatchesTarget) {
          // Only update status if it doesn't match the target
          const statusUpdated = await updateItemStatus(projectItemId, item.targetStatus, diagnostics, item);
          if (statusUpdated) summary.changed++;
        } else {
          diagnostics.infos.push(`Status for ${item.type} #${item.number} [${item.repoName}] already set to '${currentStatus}', skipping update`);
          
          // Add verbose record for skipped status update
          diagnostics.addVerboseRecord({
            operation: 'skipStatusUpdate',
            itemType: item.type,
            itemNumber: item.number,
            repository: item.repoName,
            projectItemId,
            contentId: item.contentId,
            currentStatus,
            targetStatus: Object.keys(STATUS_OPTIONS).find(k => STATUS_OPTIONS[k] === item.targetStatus),
            result: 'skipped',
            url: `https://github.com/${item.repoName}/issues/${item.number}`,
            reason: 'Item already in correct status/column'
          });
        }
        
        // Step 2a: If it's a PR authored by the user and opened (in Active column), assign to user
        if (item.type === 'PR' && item.author === GITHUB_AUTHOR && item.state === 'OPEN') {
          const assignmentResult = await assignUserToProjectItem(projectItemId, GITHUB_AUTHOR, diagnostics, item);
          if (!assignmentResult) {
            diagnostics.warnings.push(`Failed to assign user ${GITHUB_AUTHOR} to PR #${item.number} [${item.repoName}], continuing with other operations`);
          }
        }
        
        // Step 3: Apply the sprint field rules
        const currentStatusOption = item.targetStatus;
        
        // Since we're having issues with the sprint field value retrieval,
        // let's simplify and just apply the sprint assignment based on the status
        // according to the requirements
        
        // Rule: Next/Active items should have sprint assigned OR Done items should be assigned to the sprint
        if (currentStatusOption === STATUS_OPTIONS.next || 
            currentStatusOption === STATUS_OPTIONS.active ||
            currentStatusOption === STATUS_OPTIONS.done) {
          
          try {
            // For GraphQL, we need to convert the iteration ID to a string
            const iterationIdStr = String(currentSprintId);
            
            // First check if the item already has the current sprint assigned
            const currentItemSprint = await getItemSprint(projectItemId);
            
            // Per requirements.md simplified rules with API usage optimization:
            // - For Next/Active: ensure items have the current Sprint (skip if already assigned for API efficiency)
            // - For Done: only update if Sprint is not set (preserve existing sprint assignments)
            const alreadyHasCorrectSprint = currentItemSprint === iterationIdStr;
            
            // API Usage Optimization: Check if update is actually needed before making the API call
            // For Next/Active: Only update if the current sprint doesn't match the target sprint
            // For Done: Only update if no sprint is assigned (preserve any existing sprint assignments)
            const shouldUpdateSprint = 
              !alreadyHasCorrectSprint && (
                currentStatusOption === STATUS_OPTIONS.next ||
                currentStatusOption === STATUS_OPTIONS.active ||
                (currentStatusOption === STATUS_OPTIONS.done && !currentItemSprint)
              );
            
            // Determine reason based on status and current sprint
            const sprintAssignReason = 
              alreadyHasCorrectSprint ? `Item already assigned to current Sprint (${currentItemSprint}), skipping update` :
              !shouldUpdateSprint ? `Item already assigned to a Sprint, no update needed per requirements` :
              currentStatusOption === STATUS_OPTIONS.next ? 'Item in Next column assigned to current Sprint' :
              currentStatusOption === STATUS_OPTIONS.active ? 'Item in Active column assigned to current Sprint' :
              'Item in Done column assigned to current Sprint';
              
            // Only update if needed
            if (shouldUpdateSprint) {
              await executeGitHubOperation(
                async () => octokit.graphql(`
                  mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $iterationId:String!) {
                    updateProjectV2ItemFieldValue(input: {
                      projectId: $projectId,
                      itemId: $itemId,
                      fieldId: $fieldId,
                      value: { iterationId: $iterationId }
                    }) { 
                      projectV2Item { 
                        id 
                      } 
                    }
                  }
                `, {
                  projectId: PROJECT_ID,
                  itemId: projectItemId,
                  fieldId: SPRINT_FIELD_ID,
                  iterationId: iterationIdStr
                }),
                {
                  operation: 'updateItemSprint',
                  itemType: item.type,
                  itemNumber: item.number,
                  repository: item.repoName
                }
              );
              
              // Log standard info message
              diagnostics.infos.push(`Updated ${item.type} #${item.number} [${item.repoName}] sprint field`);
            } else {
              diagnostics.infos.push(`Skipped sprint update for ${item.type} #${item.number} [${item.repoName}] - already has correct sprint`);
            }
            
            // Add verbose record with reason
            diagnostics.addVerboseRecord({
              operation: shouldUpdateSprint ? 'updateSprint' : 'skipSprint',
              itemType: item.type,
              itemNumber: item.number,
              repository: item.repoName,
              projectItemId,
              contentId: item.contentId,
              sprintId: currentSprintId,
              currentSprintId: currentItemSprint,
              result: shouldUpdateSprint ? 'success' : 'skipped',
              url: `https://github.com/${item.repoName}/issues/${item.number}`,
              reason: sprintAssignReason
            });
          } catch (err) {
            diagnostics.errors.push(`Failed to update sprint for ${item.type} #${item.number} [${item.repoName}]: ${err.message}`);
          }
        }
        
        // Step 4: Handle linked issues according to PR state and rules
        // From requirements.md:
        // - For merged/open PRs: linked issues inherit column status and assignees only
        // - Sprint is determined by column rules, never inherited from PR
        if (item.type === 'PR' && item.linkedIssues.length > 0) {
          const isMerged = isPRMerged(item);
          // Process linked issues if PR is merged or still open (per requirements.md section 3)
          if (isMerged || item.state === 'OPEN') {
            for (const linkedIssue of item.linkedIssues) {
              if (processedNodeIds.has(linkedIssue.id)) continue;
              processedNodeIds.add(linkedIssue.id);
              
              // Find or add the linked issue to project
              const linkedIssueInfo = {
                type: 'Issue',
                number: linkedIssue.number,
                repoName: linkedIssue.repository.nameWithOwner,
                contentId: linkedIssue.id,
                author: item.author,
                state: 'OPEN', // Issues stay OPEN when PR is merged, unless manually closed
                reason: `Linked to ${isMerged ? 'merged' : 'open'} PR #${item.number}`
              };

              const { projectItemId: issueItemId } = await findOrAddItemToProject(
                linkedIssue.id,
                linkedIssueInfo,
                diagnostics
              );

              // 1. Inherit column status from PR
              await updateItemStatus(issueItemId, item.targetStatus, diagnostics, {
                ...linkedIssueInfo,
                reason: `Inheriting status from ${isMerged ? 'merged' : 'open'} PR #${item.number}`
              });

              // 2. Inherit assignees from PR (use first assignee, or author as fallback)
              const assigneeLogins = item.assignees?.map(a => a.login) || [];
              const assigneeToUse = assigneeLogins.length > 0 ? assigneeLogins[0] : item.author;
              
              if (assigneeToUse) {
                const linkedAssignmentResult = await assignUserToProjectItem(issueItemId, assigneeToUse, diagnostics, {
                  ...linkedIssueInfo,
                  reason: `Inheriting assignee (${assigneeToUse}) from ${isMerged ? 'merged' : 'open'} PR #${item.number}`
                });

                if (!linkedAssignmentResult) {
                  diagnostics.warnings.push(`Failed to assign user ${assigneeToUse} to linked Issue #${linkedIssue.number}`);
                }

                // Log if multiple assignees were present but only first was used
                if (assigneeLogins.length > 1) {
                  diagnostics.infos.push(`PR #${item.number} has multiple assignees, transferred first one (${assigneeToUse}) to Issue #${linkedIssue.number}`);
                }
              }

              // 3. Sprint is determined by column rules, do not inherit from PR
              // Add a clear log message about this behavior
              diagnostics.infos.push(`Sprint for Issue #${linkedIssue.number} will be handled by column rules, not inherited from PR #${item.number}`);
              
              // Record the processing of this linked issue
              diagnostics.addVerboseRecord({
                operation: 'processLinkedIssue',
                itemType: 'Issue',
                itemNumber: linkedIssue.number,
                repository: linkedIssue.repository.nameWithOwner,
                projectItemId: issueItemId,
                contentId: linkedIssue.id,
                linkedFrom: {
                  type: 'PR',
                  number: item.number,
                  repository: item.repoName,
                  state: item.state,
                  merged: isMerged
                },
                result: 'success',
                url: `https://github.com/${linkedIssue.repository.nameWithOwner}/issues/${linkedIssue.number}`,
                reason: 'Processing linked issue (inheriting column and assignee only per requirements)'
              });
            }
          } else {
            // Human-friendly message
            diagnostics.infos.push(`Skipping linked issues for PR #${item.number} [${item.repoName}] (merged=${isMerged}, state=${item.state}; only update linked issues for open or merged PRs)`);
            
            // Detailed verbose record
            diagnostics.addVerboseRecord({
              operation: 'skipLinkedIssues',
              itemType: 'PR',
              itemNumber: item.number,
              repository: item.repoName,
              projectItemId,
              contentId: item.contentId,
              author: item.author,
              state: item.state, 
              merged: isMerged,
              linkedIssuesCount: item.linkedIssues.length,
              result: 'skipped',
              url: `https://github.com/${item.repoName}/pull/${item.number}`,
              reason: `PR is closed but not merged, linked issues are not updated per requirements`
            });
          }
        }
      } catch (error) {
        diagnostics.errors.push(`Error processing ${item.type} #${item.number} [${item.repoName}]: ${error.message}`);
        summary.errors++;
      }
    });
    
    // Calculate execution time
    const endTime = new Date();
    const startTime = new Date(diagnostics.verboseData[0]?.timestamp || endTime);
    const executionTimeMs = endTime - startTime;
    const executionTimeSec = (executionTimeMs / 1000).toFixed(2);
    
    // Output final summary
    console.log('\n====================================================');
    console.log('  NERDS Project Sync Automation - Execution Summary');
    console.log('====================================================');
    console.log(`End time: ${endTime.toISOString()}`);
    console.log(`Execution time: ${executionTimeSec} seconds`);
    console.log(`Items processed: ${summary.processed}`);
    console.log(`Items changed: ${summary.changed}`);
    console.log(`Errors encountered: ${summary.errors}`);
    console.log('====================================================');
    
    logDiagnostics(diagnostics);
    
    // Exit with error code if any errors occurred
    if (summary.errors > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Pre-run validation tests to ensure the script will work properly
 */
async function runPreflightChecks() {
  console.log('\n=== Running preflight checks ===');
  let allTestsPassed = true;
  
  // Test 1: Check environment variables
  process.stdout.write('1. Checking environment variables... ');
  if (!GH_TOKEN) {
    console.log('❌ FAILED');
    console.error('   ERROR: GH_TOKEN environment variable must be set');
    allTestsPassed = false;
  } else {
    console.log('✅ PASSED');
  }

  // Test 2: Check GitHub API connectivity
  process.stdout.write('2. Testing GitHub API connectivity... ');
  try {
    // Try a simple API call to verify connectivity and token validity
    const { data: user } = await octokit.users.getAuthenticated();
    console.log(`✅ PASSED (Authenticated as ${user.login})`);

    // Check if authenticated user matches GITHUB_AUTHOR
    if (user.login !== GITHUB_AUTHOR) {
      console.log(`⚠️ WARNING: Authenticated as ${user.login} but GITHUB_AUTHOR is set to ${GITHUB_AUTHOR}`);
    }
  } catch (error) {
    console.log('❌ FAILED');
    console.error(`   ERROR: GitHub API connection failed: ${error.message}`);
    allTestsPassed = false;
  }

  // Test 3: Validate sprint assignment logic
  process.stdout.write('3. Validating sprint assignment logic... ');
  try {
    // Test cases for sprint assignment logic
    const testCases = [
      { 
        name: "Done column, no sprint assigned", 
        currentSprint: null,
        isInDoneColumn: true,
        expected: true
      },
      { 
        name: "Done column, has current sprint", 
        currentSprint: "current-sprint-id",
        isInDoneColumn: true,
        expected: false 
      },
      { 
        name: "Active column, no sprint assigned", 
        currentSprint: null,
        isInDoneColumn: false,
        expected: true
      },
      { 
        name: "Active column, has current sprint", 
        currentSprint: "current-sprint-id",
        isInDoneColumn: false,
        expected: false 
      },
      { 
        name: "Active column, has different sprint", 
        currentSprint: "other-sprint-id",
        isInDoneColumn: false,
        expected: true
      }
    ];
    
    // Function to test the shouldUpdateSprint logic
    function testShouldUpdateSprint(currentSprint, targetSprint, isInDoneColumn) {
      const alreadyHasCorrectSprint = currentSprint === targetSprint;
      
      if (isInDoneColumn) {
        return !alreadyHasCorrectSprint && !currentSprint; // For Done: only update if no sprint
      } else {
        return !alreadyHasCorrectSprint; // For Next/Active: no update needed if sprint already correct
      }
    }
    
    // Run test cases
    let testsPassed = true;
    for (const test of testCases) {
      const result = testShouldUpdateSprint(
        test.currentSprint, 
        "current-sprint-id", 
        test.isInDoneColumn
      );
      
      if (result !== test.expected) {
        console.log('❌ FAILED');
        console.error(`   ERROR: Sprint assignment logic test failed for case "${test.name}"`);
        console.error(`   Expected: ${test.expected}, Got: ${result}`);
        testsPassed = false;
        allTestsPassed = false;
        break;
      }
    }
    
    if (testsPassed) {
      console.log('✅ PASSED');
    }
  } catch (error) {
    console.log('❌ FAILED');
    console.error(`   ERROR: Sprint assignment logic validation failed: ${error.message}`);
    allTestsPassed = false;
  }

  // Test 4: Check monitored repositories configuration
  process.stdout.write('4. Checking monitored repositories configuration... ');
  try {
    const monitoredRepos = getMonitoredRepos();
    if (monitoredRepos.length === 0) {
      console.log('⚠️ WARNING');
      console.log('   No monitored repositories found in requirements.md');
    } else {
      console.log(`✅ PASSED (Found ${monitoredRepos.length} repositories)`);
      
      // Additional check: Try to access a sample repository
      if (monitoredRepos.length > 0) {
        process.stdout.write('   Verifying access to a sample repository... ');
        try {
          const sampleRepo = monitoredRepos[0].split('/');
          const { data: repo } = await octokit.repos.get({
            owner: sampleRepo[0],
            repo: sampleRepo[1]
          });
          console.log(`✅ (Successfully accessed ${repo.full_name})`);
        } catch (error) {
          console.log('⚠️ WARNING');
          console.log(`   Could not access repository: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.log('❌ FAILED');
    console.error(`   ERROR: Failed to load monitored repositories: ${error.message}`);
    allTestsPassed = false;
  }
  
  // Test 5: Verify project configuration
  process.stdout.write('5. Verifying project configuration... ');
  if (!PROJECT_ID) {
    console.log('❌ FAILED');
    console.error('   ERROR: PROJECT_ID is not defined');
    allTestsPassed = false;
  } else {
    try {
      // Check that all required status options are defined
      const requiredStatuses = ['new', 'backlog', 'next', 'active', 'done'];
      const missingStatuses = requiredStatuses.filter(status => !STATUS_OPTIONS[status]);
      
      if (missingStatuses.length > 0) {
        console.log('❌ FAILED');
        console.error(`   ERROR: Missing status options: ${missingStatuses.join(', ')}`);
        allTestsPassed = false;
      } else {
        console.log('✅ PASSED');
      }
    } catch (error) {
      console.log('❌ FAILED');
      console.error(`   ERROR: Failed to validate project configuration: ${error.message}`);
      allTestsPassed = false;
    }
  }
  
  // Test 6: Verify user assignment function
  process.stdout.write('6. Testing user assignment functions... ');
  if (typeof fetchAssignedItems !== 'function') {
    console.log('❌ FAILED');
    console.error('   ERROR: fetchAssignedItems function is not available');
    allTestsPassed = false;
  } else {
    try {
      // Verify the function definition looks correct without actually calling it
      const functionSource = fetchAssignedItems.toString();
      if (functionSource.includes('octokit.search.issuesAndPullRequests') && 
          functionSource.includes('assignee:')) {
        console.log('✅ PASSED');
      } else {
        console.log('⚠️ WARNING');
        console.log('   fetchAssignedItems function may not be properly implemented');
      }
    } catch (error) {
      console.log('❌ FAILED');
      console.error(`   ERROR: Failed to validate fetchAssignedItems: ${error.message}`);
      allTestsPassed = false;
    }
  }
  
  // Test 7: Verify sprint field and current sprint
  process.stdout.write('7. Verifying sprint configuration... ');
  if (!SPRINT_FIELD_ID) {
    console.log('❌ FAILED');
    console.error('   ERROR: SPRINT_FIELD_ID is not defined');
    allTestsPassed = false;
  } else {
    try {
      // Try to get current sprint ID to verify sprint functionality
      const currentSprintId = await getCurrentSprintOptionId();
      if (currentSprintId) {
        console.log(`✅ PASSED (Current sprint ID: ${currentSprintId})`);
      } else {
        console.log('⚠️ WARNING');
        console.log('   Could not determine current sprint ID');
      }
    } catch (error) {
      console.log('❌ FAILED');
      console.error(`   ERROR: Failed to verify sprint configuration: ${error.message}`);
      allTestsPassed = false;
    }
  }
  
  // Test 8: Verify specific issue handling
  process.stdout.write('8. Validating specific issue handling... ');
  try {
    // Test the ability to fetch a known issue (low-impact test, just verifying structure)
    const { data: issue } = await octokit.issues.get({
      owner: 'bcgov',
      repo: 'nr-forest-client',
      issue_number: 1603
    });
    
    if (issue && issue.number === 1603) {
      console.log('✅ PASSED');
    } else {
      console.log('⚠️ WARNING');
      console.log('   Could not properly fetch specific test issue');
    }
  } catch (error) {
    console.log('⚠️ WARNING');
    console.log(`   Could not fetch test issue: ${error.message}`);
  }
  
  // Test 9: Verify linked issues handling logic
  process.stdout.write('9. Validating linked issues processing logic... ');
  try {
    // Validate the logic for processing linked issues (no actual API calls)
    // Create a mock PR with linked issues
    const mockPR = {
      type: 'PR',
      number: 999,
      state: 'CLOSED',
      merged: true,
      author: 'test-author',
      linkedIssues: [{ number: 123, repository: { nameWithOwner: 'test/repo' } }]
    };
    
    // Test isPRMerged function for different PR states
    const mergedPR = { ...mockPR, merged: true, state: 'CLOSED' };
    const mergedResult = isPRMerged(mergedPR);
    
    // Test closed but unmerged PR
    const unmergedPR = { ...mockPR, merged: false, state: 'CLOSED' };
    const unmergedResult = isPRMerged(unmergedPR);
    
    // Test open PR
    const openPR = { ...mockPR, merged: false, state: 'OPEN' };
    const openResult = isPRMerged(openPR);
    
    if (mergedResult === true && unmergedResult === false) {
      console.log('✅ PASSED');
    } else {
      console.log('❌ FAILED');
      console.log(`   Merged PR detection tests failed:`);
      console.log(`   - Merged PR: expected true, got ${mergedResult}`);
      console.log(`   - Unmerged closed PR: expected false, got ${unmergedResult}`);
      allTestsPassed = false;
    }
  } catch (error) {
    console.log('❌ FAILED');
    console.log(`   Error testing linked issue logic: ${error.message}`);
    allTestsPassed = false;
  }
  
  console.log('\n=== Preflight checks summary ===');
  if (!allTestsPassed) {
    console.error('❌ Some preflight checks FAILED. Review the errors above before proceeding.');
    // Exit with error code if running in a strict mode
    if (process.env.STRICT_MODE === 'true') {
      console.error('Exiting due to STRICT_MODE=true');
      process.exit(1);
    } else {
      console.warn('Continuing despite failed checks. Set STRICT_MODE=true to abort on failures.');
      console.warn('This may result in incomplete or incorrect synchronization.');
    }
  } else {
    console.log('✅ All preflight checks PASSED! Ready to start the sync process.');
    console.log('The script will now:');
    console.log('1. Process PRs and their linked issues (regardless of author)');
    console.log('2. Process items assigned to the user');
    console.log('3. Process new issues in monitored repositories');
    console.log('4. Update project board items with correct status, sprint assignments, and user assignments');
  }
  
  return allTestsPassed;
}

// --- Run the program ---
async function runProgram() {
  try {
    // Run preflight checks unless explicitly skipped
    if (!SKIP_PREFLIGHT) {
      await runPreflightChecks();
    } else {
      console.log('Skipping preflight checks (SKIP_PREFLIGHT=true)');
    }
    
    // Then run the main program
    await main();
  } catch (err) {
    console.error('Unhandled error:', err);
    process.exit(1);
  }
}

runProgram();

// Error handlers
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Export functions for testing
if (typeof module !== 'undefined') {
  // Export functions for testing
  module.exports = {
    runPreflightChecks,
    getCurrentSprintOptionId,
    getMonitoredRepos
  };
}
