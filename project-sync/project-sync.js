// SCOPE: This script manages issues and PRs across all bcgov repositories and a single GitHub Projects v2 board, 
// strictly following the automation rules defined in requirements.md.
// All logic is requirements-driven; any changes to automation must be made in requirements.md and reflected here.
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");

// Environment variables
const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
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
  }
}

// --- Helper Functions ---

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
  `, { projectId: PROJECT_ID });
  
  const sprintField = res.node.fields.nodes.find(f => f.id === SPRINT_FIELD_ID);
  if (!sprintField) {
    throw new Error('Sprint field not found in project configuration.');
  }
  
  const today = new Date();
  // Find the iteration (sprint) whose startDate <= today < startDate+duration
  for (const iter of sprintField.configuration.iterations) {
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
 * Get item's sprint field value
 */
async function getItemSprintFieldValue(projectItemId) {
  const res = await octokit.graphql(`
    query($projectId:ID!, $itemId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          item(id: $itemId) {
            fieldValues(first: 50) {
              nodes {
                ... on ProjectV2ItemFieldIterationValue {
                  field { id }
                  iterationId
                }
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID, itemId: projectItemId });

  if (!res.node || !res.node.item || !res.node.item.fieldValues || !res.node.item.fieldValues.nodes) {
    return null;
  }

  const sprintField = res.node.item.fieldValues.nodes.find(
    fv => fv.field && fv.field.id === SPRINT_FIELD_ID
  );

  return sprintField?.iterationId || null;
}

/**
 * Find or add an item to the project and return its project item ID
 */
async function findOrAddItemToProject(contentId) {
  // First try to find the item in the project
  let endCursor = null;
  let projectItemId = null;
  let found = false;
  
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
  }
  
  return { projectItemId, wasAdded: !found };
}

/**
 * Update an item's status in the project
 */
async function updateItemStatus(projectItemId, statusOption, diagnostics, itemInfo) {
  try {
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
    
    const columnName = Object.keys(STATUS_OPTIONS).find(k => STATUS_OPTIONS[k] === statusOption) || "unknown";
    diagnostics.infos.push(`Updated ${itemInfo.type} #${itemInfo.number} to column "${columnName}"`);
    
    return true;
  } catch (err) {
    diagnostics.errors.push(`Failed to update status for ${itemInfo.type} #${itemInfo.number}: ${err.message}`);
    return false;
  }
}

/**
 * Update an item's sprint field in the project
 */
async function updateItemSprint(projectItemId, iterationId, diagnostics, itemInfo) {
  try {
    await octokit.graphql(`
      mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $iterationId:ID!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { iterationId: $iterationId }
        }) { projectV2Item { id } }
      }
    `, {
      projectId: PROJECT_ID,
      itemId: projectItemId,
      fieldId: SPRINT_FIELD_ID,
      iterationId: iterationId
    });
    
    diagnostics.infos.push(`Updated ${itemInfo.type} #${itemInfo.number} sprint field`);
    return true;
  } catch (err) {
    diagnostics.errors.push(`Failed to update sprint for ${itemInfo.type} #${itemInfo.number}: ${err.message}`);
    return false;
  }
}

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
        const targetStatus = pr.state === 'OPEN' ? STATUS_OPTIONS.active : STATUS_OPTIONS.done;
        
        itemsToProcess.push({
          contentId: pr.id,
          type: 'PR',
          number: pr.number,
          repoName: pr.repository.nameWithOwner,
          targetStatus,
          linkedIssues: pr.closingIssuesReferences?.nodes || [],
          state: pr.state,
          closedAt: pr.closedAt
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
        
        // Only process new issues to be added to the board
        itemsToProcess.push({
          contentId: issue.id,
          type: 'Issue',
          number: issue.number,
          repoName: issue.repository.nameWithOwner,
          targetStatus: STATUS_OPTIONS.new,
          state: issue.state,
          closedAt: issue.closedAt
        });
      }
    }
    
    console.log(`Processing ${itemsToProcess.length} items...`);
    
    // Process all items
    await processInBatches(itemsToProcess, 10, 1000, async (item) => {
      summary.processed++;
      
      try {
        // Step 1: Find or add the item to the project
        const { projectItemId, wasAdded } = await findOrAddItemToProject(item.contentId);
        
        if (wasAdded) {
          diagnostics.infos.push(`Added ${item.type} #${item.number} from ${item.repoName} to project`);
        }
        
        // Skip further processing for issues that were already in the project
        // According to requirements, we only add new issues but don't update existing ones
        if (item.type === 'Issue' && !wasAdded) {
          diagnostics.infos.push(`Skipping ${item.type} #${item.number} (already in project)`);
          return;
        }
        
        // Step 2: Update the status
        const statusUpdated = await updateItemStatus(projectItemId, item.targetStatus, diagnostics, item);
        if (statusUpdated) summary.changed++;
        
        // Step 3: Apply the sprint field rules
        const currentStatusOption = item.targetStatus;
        const currentSprintValue = await getItemSprintFieldValue(projectItemId);
        
        // Rule: Next/Active items should have sprint assigned
        if (currentStatusOption === STATUS_OPTIONS.next || 
            currentStatusOption === STATUS_OPTIONS.active) {
          await updateItemSprint(projectItemId, currentSprintId, diagnostics, item);
        }
        // Rule: Done items should have sprint if not already assigned
        else if (currentStatusOption === STATUS_OPTIONS.done && !currentSprintValue) {
          await updateItemSprint(projectItemId, currentSprintId, diagnostics, item);
        }
        
        // Step 4: For PRs, also handle linked issues if PR is merged
        if (item.type === 'PR' && item.state === 'MERGED' && item.linkedIssues.length > 0) {
          for (const linkedIssue of item.linkedIssues) {
            if (processedNodeIds.has(linkedIssue.id)) continue;
            processedNodeIds.add(linkedIssue.id);
            
            // Find the linked issue in the project
            const { projectItemId: issueItemId } = await findOrAddItemToProject(linkedIssue.id);
            
            // Update status to match PR
            await updateItemStatus(issueItemId, item.targetStatus, diagnostics, {
              type: 'Issue',
              number: linkedIssue.number,
              repoName: linkedIssue.repository.nameWithOwner
            });
            
            // Update sprint to match PR
            await updateItemSprint(issueItemId, currentSprintId, diagnostics, {
              type: 'Issue',
              number: linkedIssue.number,
              repoName: linkedIssue.repository.nameWithOwner
            });
          }
        }
      } catch (error) {
        diagnostics.errors.push(`Error processing ${item.type} #${item.number}: ${error.message}`);
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
