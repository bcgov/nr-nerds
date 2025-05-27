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
          author: pr.author?.login
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
          author: issue.author?.login
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
        
        // Apply specific rules based on requirements.md:
        // 1. For PRs: Only author's PRs get automatic status updates 
        // 2. For issues: Only new issues get added to "New" column; existing issues stay as they are
        
        // Skip further processing for issues that were already in the project
        if (item.type === 'Issue' && !wasAdded) {
          diagnostics.infos.push(`Skipping ${item.type} #${item.number} (already in project)`);
          return;
        }
        
        // Skip status updates for PRs not authored by the specified user
        if (item.type === 'PR' && item.author !== GITHUB_AUTHOR) {
          diagnostics.infos.push(`Skipping PR #${item.number} status update (not authored by ${GITHUB_AUTHOR})`);
          return;
        }
        
        // Step 2: Update the status
        const statusUpdated = await updateItemStatus(projectItemId, item.targetStatus, diagnostics, item);
        if (statusUpdated) summary.changed++;
        
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
            
            diagnostics.infos.push(`Updated ${item.type} #${item.number} sprint field`);
          } catch (err) {
            diagnostics.errors.push(`Failed to update sprint for ${item.type} #${item.number}: ${err.message}`);
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
              const { projectItemId: issueItemId } = await findOrAddItemToProject(linkedIssue.id);
              
              // Update status to match PR
              await updateItemStatus(issueItemId, item.targetStatus, diagnostics, {
                type: 'Issue',
                number: linkedIssue.number,
                repoName: linkedIssue.repository.nameWithOwner
              });
              
              // Update sprint to match PR
              try {
                const iterationIdStr = String(currentSprintId);
                
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
                
                diagnostics.infos.push(`Updated linked Issue #${linkedIssue.number} sprint field`);
              } catch (err) {
                diagnostics.errors.push(`Failed to update sprint for linked Issue #${linkedIssue.number}: ${err.message}`);
              }
            }
          } else {
            diagnostics.infos.push(`Skipping linked issues for PR #${item.number} (merged=${item.merged}, state=${item.state}; only update linked issues for open or merged PRs)`);
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
