// SCOPE: This script manages issues and PRs across all bcgov repositories and a single GitHub Projects v2 board, 
// strictly following the automation rules defined in requirements.md.
// All logic is requirements-driven; any changes to automation must be made in requirements.md and reflected here.
//
// USAGE:
// - Run with VERBOSE=true to enable detailed JSON logging of all operations
// - Example: VERBOSE=true node project-sync.js
// - Verbose JSON logs will be written to project-sync-log-[timestamp].json
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");

// Environment variables
const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const VERBOSE = process.env.VERBOSE === 'true' || process.env.VERBOSE === '1';
const octokit = new Octokit({ auth: GH_TOKEN });

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

// --- Helper Classes ---
class DiagnosticsContext {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.infos = [];
    this.verboseData = []; // For storing detailed JSON records
  }

  /**
   * Add a detailed verbose record for troubleshooting
   * @param {Object} data - Structured data about the operation
   */
  addVerboseRecord(data) {
    // Ensure timestamp is added to each record
    this.verboseData.push({
      timestamp: new Date().toISOString(),
      ...data
    });
  }
}

// --- Helper Functions ---

/**
 * Assign a user to a project item
 * @param {string} projectItemId - The project item ID
 * @param {string} userId - GitHub user ID to assign
 * @param {Object} diagnostics - Diagnostics context for logging
 * @param {Object} itemInfo - Information about the item being processed
 */
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
      // In GitHub's API, pull requests are treated as issues for assignment operations
      // Use only the issues endpoint for both types
      const response = await octokit.issues.addAssignees({
        owner,
        repo,
        issue_number: itemNumber,
        assignees: [userId]
      });
      
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
        assignees: response.data.assignees ? response.data.assignees.map(a => a.login) : [userId],
        url: itemInfo.url || `https://github.com/${itemInfo.repoName}/issues/${itemInfo.number}`,
        reason: `Assigning ${itemInfo.type} to user based on requirements`
      });
      
      return true;
    } catch (apiErr) {
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
  const res = await octokit.graphql(`
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
  `, { projectId: PROJECT_ID });
  
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
    const startIdx = lines.findIndex(l => l.trim().startsWith('## Monitored Repositories'));
    
    if (startIdx === -1) return [];
    
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
    const res = await octokit.graphql(`
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
    `, { projectId: PROJECT_ID, after: endCursor });
    
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
    const addResult = await octokit.graphql(`
      mutation($projectId:ID!, $contentId:ID!) {
        addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
          item { id }
        }
      }
    `, { projectId: PROJECT_ID, contentId });

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
    await octokit.graphql(`
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
    });
    
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
 * Get the current Sprint field value for a project item
 * @param {string} projectItemId - The project item ID
 * @returns {Promise<string|null>} The current sprint iteration ID, or null if not found/set
 */
async function getItemSprint(projectItemId) {
  try {
    const res = await octokit.graphql(`
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
      }
    `, { 
      itemId: projectItemId
    });
    
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
  let issues = [];
  let prs = [];
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const res = await octokit.graphql(`
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
    `, { owner, repo, after: endCursor });

    // Only include items updated since the cutoff date
    const cutoffDateIso = cutoffDate.toISOString();
    const filteredIssues = res.repository.issues.nodes
      .filter(issue => new Date(issue.updatedAt) >= cutoffDate);
    
    const filteredPRs = res.repository.pullRequests.nodes
      .filter(pr => new Date(pr.updatedAt) >= cutoffDate);
    
    issues.push(...filteredIssues);
    prs.push(...filteredPRs);
    
    // Check if we need to paginate for more results
    const issuesPagination = res.repository.issues.pageInfo;
    const prsPagination = res.repository.pullRequests.pageInfo;
    
    hasNextPage = issuesPagination.hasNextPage || prsPagination.hasNextPage;
    endCursor = issuesPagination.hasNextPage ? issuesPagination.endCursor : prsPagination.endCursor;
    
    // If we've got a lot of old items (before cutoff date), we can stop paginating
    const oldItemsCount = res.repository.issues.nodes.length - filteredIssues.length +
                          res.repository.pullRequests.nodes.length - filteredPRs.length;
    if (oldItemsCount > 40) {
      break; // Most items are old, unlikely to find newer ones by paginating further
    }
  }
  
  return { issues, prs };
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
      const logFileName = `project-sync-log-${timestamp}.json`;
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
    console.log('Starting project sync...');
    
    // Log the implementation of rules
    console.log('Applying rules from requirements.md:');
    console.log('- PRs authored by user will be moved to Active (if open) or Done (if closed)');
    console.log('- Issues linked to PRs will inherit status from PR only if PR is merged or open');
    console.log('- New issues in monitored repos will be added to New column');
    console.log('- Issues already in the project will be left unchanged');
    console.log('- Items in Next/Active/Done columns will be assigned to current Sprint');
    
    // Load configuration
    const monitoredRepos = getMonitoredRepos();
    console.log(`Monitoring ${monitoredRepos.length} repositories: ${monitoredRepos.join(', ')}`);
    
    // Calculate cutoff date (2 days ago)
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    console.log(`Processing items updated since: ${twoDaysAgo.toISOString()}`);
    
    // Get current sprint ID
    const currentSprintId = await getCurrentSprintOptionId();
    console.log(`Current sprint ID: ${currentSprintId}`);
    
    // Track processed items to avoid duplicates
    const processedNodeIds = new Set();
    const itemsToProcess = [];
    
    // --- 1. Find user's PRs from all monitored repos ---
    for (const repoFullName of monitoredRepos) {
      const [owner, repo] = repoFullName.split('/');
      const { prs } = await fetchRecentItemsFromRepo(owner, repo, twoDaysAgo);
      
      // Get PRs authored by the specified user
      const userPRs = prs.filter(pr => pr.author && pr.author.login === GITHUB_AUTHOR);
      
      for (const pr of userPRs) {
        if (processedNodeIds.has(pr.id)) continue;
        processedNodeIds.add(pr.id);
        
        // Determine target status based on PR state
        // According to requirements.md:
        // - New PRs authored by the user: Move to "Active"
        // - PRs authored by the user and closed: Move to "Done"
        const targetStatus = pr.state === 'OPEN' ? STATUS_OPTIONS.active : STATUS_OPTIONS.done;
        
        // Track whether the PR is merged or just closed
        const isMerged = pr.merged === true;
        
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
        
        // Skip further processing for issues that were already in the project
        if (item.type === 'Issue' && !wasAdded) {
          diagnostics.infos.push(`Skipping ${item.type} #${item.number} [${item.repoName}] (already in project)`);
          
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
            reason: 'Issue already exists in project board, not updating per requirements'
          });
          return;
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
        
        // Step 2: Update the status
        const statusUpdated = await updateItemStatus(projectItemId, item.targetStatus, diagnostics, item);
        if (statusUpdated) summary.changed++;
        
        // Step 2a: If it's a PR authored by the user and opened (in Active column), assign to user
        if (item.type === 'PR' && item.author === GITHUB_AUTHOR && item.state === 'OPEN') {
          await assignUserToProjectItem(projectItemId, GITHUB_AUTHOR, diagnostics, item);
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
            
            // Per requirements.md: 
            // - For Next/Active: always update sprint (even if already set)
            // - For Done: only update if not already assigned
            const shouldUpdateSprint = 
              currentStatusOption === STATUS_OPTIONS.next ||
              currentStatusOption === STATUS_OPTIONS.active ||
              (currentStatusOption === STATUS_OPTIONS.done && (!currentItemSprint || currentItemSprint !== iterationIdStr));
            
            // Determine reason based on status and current sprint
            const sprintAssignReason = 
              !shouldUpdateSprint ? `Item already assigned to current Sprint, no update needed` :
              currentStatusOption === STATUS_OPTIONS.next ? 'Item in Next column assigned to current Sprint' :
              currentStatusOption === STATUS_OPTIONS.active ? 'Item in Active column assigned to current Sprint' :
              'Item in Done column assigned to current Sprint';
              
            // Only update if needed
            if (shouldUpdateSprint) {
              await octokit.graphql(`
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
              });
              
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
        // - New link: inherit the sprint and column from its PR
        // - PR merged: inherit the sprint and column from its PR
        // - PR closed (not merged): do not change the issue's column or sprint
        if (item.type === 'PR' && item.linkedIssues.length > 0 && item.author === GITHUB_AUTHOR) {
          // Only process linked issues if the PR is authored by the user AND
          // it's either merged or still open (new link)
          if (item.merged === true || item.state === 'OPEN') {
            for (const linkedIssue of item.linkedIssues) {
              if (processedNodeIds.has(linkedIssue.id)) continue;
              processedNodeIds.add(linkedIssue.id);
              
              // Find the linked issue in the project
              const linkedIssueInfo = {
                type: 'Issue',
                number: linkedIssue.number,
                repoName: linkedIssue.repository.nameWithOwner,
                contentId: linkedIssue.id,
                reason: `Linked to PR #${item.number} (${item.merged ? 'merged' : 'open'})`
              };
              const { projectItemId: issueItemId, currentStatus } = await findOrAddItemToProject(
                linkedIssue.id,
                linkedIssueInfo,
                diagnostics
              );
              
              // Store the current status for the detailed output
              linkedIssueInfo.currentStatus = currentStatus;
              
              // Update status to match PR
              await updateItemStatus(issueItemId, item.targetStatus, diagnostics, {
                type: 'Issue',
                number: linkedIssue.number,
                repoName: linkedIssue.repository.nameWithOwner,
                contentId: linkedIssue.id,
                currentStatus: linkedIssueInfo.currentStatus,
                reason: `Inheriting status from ${item.merged ? 'merged' : 'open'} PR #${item.number}`
              });
              
              // Assign the same user as the PR (as per requirements)
              await assignUserToProjectItem(issueItemId, GITHUB_AUTHOR, diagnostics, {
                type: 'Issue',
                number: linkedIssue.number,
                repoName: linkedIssue.repository.nameWithOwner,
                contentId: linkedIssue.id,
                reason: `Inheriting user assignment from ${item.merged ? 'merged' : 'open'} PR #${item.number}`
              });
              
              // Update sprint to match PR
              try {
                const iterationIdStr = String(currentSprintId);
                
                // Check if the issue already has the correct sprint assigned
                const currentIssueSprint = await getItemSprint(issueItemId);
                const shouldUpdateSprint = !currentIssueSprint || currentIssueSprint !== iterationIdStr;
                
                if (shouldUpdateSprint) {
                  await octokit.graphql(`
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
                    itemId: issueItemId,
                    fieldId: SPRINT_FIELD_ID,
                    iterationId: iterationIdStr
                  });
                  
                  // Log standard message
                  diagnostics.infos.push(`Updated linked Issue #${linkedIssue.number} [${linkedIssue.repository.nameWithOwner}] sprint field`);
                } else {
                  diagnostics.infos.push(`Skipped sprint update for linked Issue #${linkedIssue.number} [${linkedIssue.repository.nameWithOwner}] - already has correct sprint`);
                }
                
                // Add verbose record with reason
                diagnostics.addVerboseRecord({
                  operation: shouldUpdateSprint ? 'updateSprint' : 'skipSprint',
                  itemType: 'Issue',
                  itemNumber: linkedIssue.number,
                  repository: linkedIssue.repository.nameWithOwner,
                  projectItemId: issueItemId,
                  contentId: linkedIssue.id,
                  sprintId: currentSprintId,
                  currentSprintId: currentIssueSprint,
                  result: shouldUpdateSprint ? 'success' : 'skipped',
                  linkedFrom: {
                    type: 'PR',
                    number: item.number,
                    repository: item.repoName,
                    state: item.state,
                    merged: item.merged
                  },
                  url: `https://github.com/${linkedIssue.repository.nameWithOwner}/issues/${linkedIssue.number}`,
                  reason: shouldUpdateSprint
                    ? `Issue inheriting sprint field from ${item.merged ? 'merged' : 'open'} PR #${item.number}`
                    : `Issue already has current sprint assigned, no update needed`
                });
              } catch (err) {
                diagnostics.errors.push(`Failed to update sprint for linked Issue #${linkedIssue.number} [${linkedIssue.repository.nameWithOwner}]: ${err.message}`);
              }
            }
          } else {
            // Human-friendly message
            diagnostics.infos.push(`Skipping linked issues for PR #${item.number} [${item.repoName}] (merged=${item.merged}, state=${item.state}; only update linked issues for open or merged PRs)`);
            
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
              merged: item.merged,
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
    
    // Output final summary
    console.log(`\nSummary:`);
    console.log(`- Items processed: ${summary.processed}`);
    console.log(`- Items changed: ${summary.changed}`);
    console.log(`- Errors encountered: ${summary.errors}`);
    
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

// --- Run the program ---
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

// Error handlers
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
