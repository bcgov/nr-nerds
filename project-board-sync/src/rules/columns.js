const { getItemColumn, setItemColumn, isItemInProject, octokit } = require('../github/api');
const { log } = require('../utils/log');

// Column names to option IDs mapping - will be populated at runtime
let columnOptions = null;

/**
 * Get status field configuration from project
 * @param {string} projectId - The project board ID
 * @returns {Promise<Map<string, string>>} Map of column names to option IDs
 */
async function getColumnOptions(projectId) {
  if (columnOptions) return columnOptions;

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
  columnOptions = new Map();
  const options = result.node.field.options || [];
  for (const opt of options) {
    columnOptions.set(opt.name.toLowerCase(), opt.id);
  }

  return columnOptions;
}

/**
 * Get the option ID for a column name
 * @param {string} columnName - The name of the column
 * @param {Map<string, string>} options - Column options mapping
 * @returns {string} The option ID
 * @throws {Error} If column not found
 */
function getColumnOptionId(columnName, options) {
  const optionId = options.get(columnName.toLowerCase());
  if (!optionId) {
    throw new Error(`Column "${columnName}" not found in project. Available columns: ${[...options.keys()].join(', ')}`);
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
    
    // Skip if already has any column set
    if (currentColumn) {
      return { 
        changed: false, 
        reason: `Column already set to ${currentColumn}`,
        currentStatus: currentColumn 
      };
    }

    // Determine target column based on item type per requirements
    const targetColumn = item.__typename === 'PullRequest' ? 'Active' : 'New';
    const optionId = getColumnOptionId(targetColumn, options);

    // Set the column
    await setItemColumn(projectId, projectItemId, optionId);

    return {
      changed: true,
      newStatus: targetColumn,
      reason: `Set initial column to ${targetColumn}`
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
 * | Issue     | Column=None       | Column=New    | Column=Any already set |
 */
async function processColumns({ projectId, items }) {
  const processedItems = [];
  const skippedItems = [];

  for (const item of items) {
    try {
      // Process column assignment
      const result = await processColumnAssignment(item, item.id, projectId);
      
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
