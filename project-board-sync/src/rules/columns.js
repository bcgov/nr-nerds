const { getItemColumn, setItemColumn, isItemInProject, octokit } = require('../github/api');
const { log } = require('../utils/log');

// Cache column options per project ID during a single run
const columnOptionsCache = new Map();

/**
 * Get status field configuration from project
 * Uses in-memory cache to avoid repeated API calls within a single run
 * @param {string} projectId - The project board ID
 * @returns {Promise<Map<string, string>>} Map of column names to option IDs
 */
async function getColumnOptions(projectId) {
  // Check cache first
  if (columnOptionsCache.has(projectId)) {
    log.debug(`Using cached column options for project ${projectId}`);
    return columnOptionsCache.get(projectId);
  }

  // Cache miss - fetch from API
  log.debug(`Fetching column options for project ${projectId}`);
  const result = await octokit.graphql(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          field(name: "Status") {
            ... on ProjectV2SingleSelectField {
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  `, { projectId });

  // Create mapping of column names to option IDs
  const columnMap = new Map();
  const options = result.node.field.options || [];
  for (const opt of options) {
    // Store both exact name and lowercase for case-insensitive lookup
    columnMap.set(opt.name, opt.id);
    columnMap.set(opt.name.toLowerCase(), opt.id);
  }

  // Cache the result
  columnOptionsCache.set(projectId, columnMap);
  
  return columnMap;
}

/**
 * Get the option ID for a column name
 * @param {string} columnName - The name of the column
 * @param {Map<string, string>} options - Column options mapping
 * @returns {string} The option ID
 * @throws {Error} If column not found
 */
function getColumnOptionId(columnName, options) {
  // Try exact match first, then case-insensitive
  const optionId = options.get(columnName) || options.get(columnName.toLowerCase());
  if (!optionId) {
    // Get original case-sensitive column names, removing duplicates while preserving case
    const uniqueColumns = [...new Set([...options.keys()].filter((k, i, arr) => 
      arr.findIndex(item => item.toLowerCase() === k.toLowerCase()) === i
    ))];
    throw new Error(`Column "${columnName}" not found in project. Available columns: ${uniqueColumns.join(', ')}`);
  }
  return optionId;
}

/**
 * Process column assignment for an item based on requirements
 * @param {Object} item - The issue or PR
 * @param {string} projectItemId - The project item ID
 * @param {string} projectId - The project board ID
 * @returns {Promise<{changed: boolean, newStatus?: string}>}
 */
async function processColumnAssignment(item, projectItemId, projectId) {
  try {
    // First get available columns
    const options = await getColumnOptions(projectId);
    
    // Get current column
    const currentColumn = await getItemColumn(projectId, projectItemId);
    const currentColumnLower = currentColumn ? currentColumn.toLowerCase() : null;

    let targetColumn = null;
    let reason = '';

    log.info(`Processing column rules for ${item.__typename} #${item.number}:`, true);
    log.info(`  • Current column: ${currentColumn || 'None'}`, true);
    log.info(`  • Item type: ${item.__typename}`, true);
    log.info(`  • Item state: ${item.state || 'Unknown'}`, true);

    // Skip if item is closed/merged and already in Done column
    if ((item.state === 'CLOSED' || item.state === 'MERGED') && currentColumnLower === 'done') {
      log.info('  • Rule: Item is closed/merged and in Done column → Skipping', true);
      return {
        changed: false,
        reason: 'Column already set to Done by GitHub automation',
        currentStatus: currentColumn
      };
    }

    // Skip if item is closed/merged (GitHub handles these)
    if (item.state === 'CLOSED' || item.state === 'MERGED') {
      log.info('  • Rule: Item is closed/merged → GitHub handles column', true);
      return {
        changed: false,
        reason: `Column handled by GitHub automation for ${item.state.toLowerCase()} items`,
        currentStatus: currentColumn
      };
    }

    // Handle PRs and Issues according to requirements
    if (item.__typename === 'PullRequest') {
      // For PRs: Move to Active if either:
      // 1. Column is None
      // 2. Column is New
      if (!currentColumn || currentColumnLower === 'new') {
        targetColumn = 'Active';
        reason = !currentColumn ? 'Initial PR placement in Active' : 'PR moved from New to Active';
        log.info(`  • Rule: ${!currentColumn ? 'Column=None' : 'Column=New'} → Moving PR to Active`, true);
      }
    } else if (item.__typename === 'Issue' && !currentColumn) {
      // For Issues: Only set column if none is set
      targetColumn = 'New';
      reason = 'Initial issue placement in New';
      log.info('  • Rule: Column=None → Setting initial issue column to New', true);
    }

    // Skip if no target column determined
    if (!targetColumn) {
      log.info('  • Result: No target column determined', true);
      return { 
        changed: false, 
        reason: 'No column change needed',
        currentStatus: currentColumn
      };
    }
    
    // If already in Done column, do not change (handled by GitHub)
    if (currentColumnLower === 'done') {
      log.info('  • Already in Done column, handled by GitHub', true);
      return {
        changed: false,
        reason: 'Column "Done" is handled by GitHub automation',
        currentStatus: currentColumn
      };
    }

    // If already in correct column, do not change
    if (currentColumnLower === targetColumn.toLowerCase()) {
      log.info(`  • Result: Already in target column (${currentColumn})`, true);
      return {
        changed: false,
        reason: `Column already set to ${currentColumn}`,
        currentStatus: currentColumn
      };
    }

    log.info(`  • Result: Moving to ${targetColumn}`, true);

    // Set the new column
    const optionId = getColumnOptionId(targetColumn, options);
    await setItemColumn(projectId, projectItemId, optionId);

    return {
      changed: true,
      newStatus: targetColumn,
      reason: reason || `Set column to ${targetColumn} based on ${item.state ? `state (${item.state})` : 'initial rules'}`
    };
  } catch (error) {
    log.error(`Failed to process column for ${item.__typename} #${item.number}: ${error.message}`);
    throw error;
  }
}

/**
 * Implementation of Rule Set 2: Which Columns Items Go To?
 * 
 * Rules from requirements.md:
 * | Item Type | Trigger Condition | Action        | Skip Condition         |
 * |-----------|-------------------|---------------|------------------------|
 * | PR        | Column=None       | Column=Active | Column=Any already set |
 * | PR        | Column=New        | Column=Active | Column=Any except New  |
 * | Issue     | Column=None       | Column=New    | Column=Any already set |
 */
async function processColumns({ projectId, items }) {
  const processedItems = [];
  const skippedItems = [];
  
  for (const item of items) {
    try {
      log.debug(`Processing column assignment for ${item.type || item.__typename} #${item.number}`);
      // Process column assignment - make sure we pass the full item with type info
      const result = await processColumnAssignment({
        ...item,
        __typename: item.type || item.__typename,
        number: item.number,
        state: item.state || 'OPEN'  // Default to OPEN if state is not provided
      }, item.projectItemId, projectId);
      
      if (result.changed) {
        processedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          column: result.newStatus,
          reason: result.reason
        });
      } else {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          column: result.currentStatus,
          reason: result.reason
        });
      }
    } catch (error) {
      log.error(`Failed to process column for ${item.__typename} #${item.number}: ${error.message}`);
    }
  }

  // Log results
  processedItems.forEach(item => {
    log.info(`${item.type} #${item.number} [${item.repo}] - ${item.reason}`);
  });

  skippedItems.forEach(item => {
    log.info(`Skipped ${item.type} #${item.number} [${item.repo}] - ${item.reason} (${item.column})`);
  });

  return { processedItems, skippedItems };
}

module.exports = {
  processColumns,
  processColumnAssignment,
  getColumnOptions
};
