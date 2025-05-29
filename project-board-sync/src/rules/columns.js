const { getItemColumn, setItemColumn, isItemInProject } = require('../github/api');
const { log } = require('../utils/log');

const STATUS_OPTIONS = {
  new: 'optionId1',     // Replace with actual option IDs from your project
  active: 'optionId2',  // These will be looked up at runtime
  done: 'optionId3'
};

/**
 * Get the current column (status) for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @returns {Promise<{statusName: string|null, statusId: string|null}>}
 */
async function getCurrentColumn(projectId, itemId) {
  const result = await octokit.graphql(`
    query($projectId: ID!, $itemId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          field(name: "Status") {
            ... on ProjectV2SingleSelectField {
              id
              options {
                id
                name
              }
            }
          }
          items(first: 1, filter: { id: $itemId }) {
            nodes {
              fieldValues(first: 1) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                  }
                }
              }
            }
          }
        }
      }
    }
  `, {
    projectId,
    itemId
  });

  const fieldValues = result.node.items.nodes[0]?.fieldValues.nodes || [];
  const statusValue = fieldValues[0];
  
  return {
    statusName: statusValue?.name || null,
    statusId: statusValue?.optionId || null
  };
}

/**
 * Set the column (status) for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @param {string} statusOptionId - The status option ID to set
 */
async function setColumn(projectId, itemId, statusOptionId) {
  await octokit.graphql(`
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { 
          singleSelectOptionId: $optionId
        }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `, {
    projectId,
    itemId,
    fieldId: 'STATUS_FIELD_ID', // TODO: Replace with actual field ID
    optionId: statusOptionId
  });
}

/**
 * Process column assignment for an item based on requirements
 * @param {Object} item - The issue or PR
 * @param {string} projectItemId - The project item ID
 * @param {string} projectId - The project board ID
 * @returns {Promise<{changed: boolean, newStatus?: string}>}
 */
async function processColumnAssignment(item, projectItemId, projectId) {
  // Get current column
  const { statusName, statusId } = await getCurrentColumn(projectId, projectItemId);
  
  // Skip if already has any column set
  if (statusId) {
    return { 
      changed: false, 
      reason: `Column already set to ${statusName}`,
      currentStatus: statusName 
    };
  }

  // Determine target column based on item type
  const targetStatusId = item.__typename === 'PullRequest' 
    ? STATUS_OPTIONS.active 
    : STATUS_OPTIONS.new;

  // Set the column
  await setColumn(projectId, projectItemId, targetStatusId);

  return {
    changed: true,
    newStatus: Object.keys(STATUS_OPTIONS).find(k => STATUS_OPTIONS[k] === targetStatusId),
    reason: `Set initial column for ${item.__typename}`
  };
}

/**
 * Implementation of Rule Set 2: Which Columns are Items Added To?
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
      // First check if item is in project
      if (!await isItemInProject(item.id, projectId)) {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          reason: 'Item not in project board'
        });
        continue;
      }

      const currentColumn = await getItemColumn(projectId, item.id);

      // Skip if column is already set (any column counts)
      if (currentColumn) {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          column: currentColumn,
          reason: 'Column already set'
        });
        continue;
      }

      // Set initial column based on item type per requirements
      const targetColumn = item.__typename === 'PullRequest' ? 'Active' : 'New';
      await setItemColumn(projectId, item.id, targetColumn);

      processedItems.push({
        type: item.__typename,
        number: item.number,
        repo: item.repository.nameWithOwner,
        column: targetColumn,
        reason: `Set initial column to ${targetColumn}`
      });

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
  processColumns
};
