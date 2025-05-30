const { octokit } = require('../github/api');
const { log } = require('../utils/log');

/**
 * Get current sprint information for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @returns {Promise<{sprintId: string|null, sprintTitle: string|null}>}
 */
async function getItemSprint(projectId, itemId) {
  const result = await octokit.graphql(`
    query($projectId: ID!, $itemId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          field(name: "Sprint") {
            ... on ProjectV2IterationField {
              id
              configuration {
                iterations {
                  id
                  title
                }
              }
            }
          }
        }
      }
      item: node(id: $itemId) {
        ... on ProjectV2Item {
          fieldValues(first: 1) {
            nodes {
              ... on ProjectV2ItemFieldIterationValue {
                iterationId
                title
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

  const fieldValues = result.item?.fieldValues.nodes || [];
  const sprintValue = fieldValues[0];
  
  return {
    sprintId: sprintValue?.iterationId || null,
    sprintTitle: sprintValue?.title || null
  };
}

/**
 * Get the current active sprint
 * @param {string} projectId - The project board ID
 * @returns {Promise<{sprintId: string, title: string}>}
 */
async function getCurrentSprint(projectId) {
  const today = new Date().toISOString();
  
  const result = await octokit.graphql(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          field(name: "Sprint") {
            ... on ProjectV2IterationField {
              id
              configuration {
                iterations {
                  id
                  title
                  duration
                  startDate
                }
              }
            }
          }
        }
      }
    }
  `, { projectId });

  const iterations = result.node.field.configuration.iterations;
  const currentSprint = iterations.find(sprint => {
    const start = new Date(sprint.startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + sprint.duration);
    const now = new Date();
    return now >= start && now < end;
  });

  if (!currentSprint) {
    throw new Error('No active sprint found');
  }

  return {
    sprintId: currentSprint.id,
    title: currentSprint.title
  };
}

/**
 * Process sprint assignment for an item based on requirements
 * @param {Object} item - The issue or PR
 * @param {string} projectItemId - The project item ID
 * @param {string} projectId - The project board ID
 * @param {string} currentColumn - The item's current column name
 * @returns {Promise<{changed: boolean, newSprint?: string}>}
 */
async function processSprintAssignment(item, projectItemId, projectId, currentColumn) {
  // Only process items in Next, Active, or Done columns
  if (!['Next', 'Active', 'Done'].includes(currentColumn)) {
    return { 
      changed: false, 
      reason: 'Not in Next, Active, or Done column' 
    };
  }

  // Get current sprint assignment
  const { sprintId: currentSprintId, sprintTitle: currentSprintTitle } = 
    await getItemSprint(projectId, projectItemId);

  // Get active sprint
  const { sprintId: activeSprintId, title: activeSprintTitle } = 
    await getCurrentSprint(projectId);

  // Check skip conditions
  if (currentColumn === 'Done') {
    // For Done: skip if any sprint is set
    if (currentSprintId) {
      return {
        changed: false,
        reason: `Item in Done has sprint set (${currentSprintTitle})`
      };
    }
  } else {
    // For Next/Active: skip if current sprint is already set
    if (currentSprintId === activeSprintId) {
      return {
        changed: false,
        reason: 'Item already assigned to current sprint'
      };
    }
  }

  // Set the sprint
  await octokit.graphql(`
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { iterationId: $iterationId }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `, {
    projectId,
    itemId: projectItemId,
    fieldId: 'ITERATION_FIELD_ID', // TODO: Replace with actual field ID
    iterationId: activeSprintId
  });

  return {
    changed: true,
    newSprint: activeSprintId,
    reason: `Assigned to current sprint (${activeSprintTitle})`
  };
}

module.exports = {
  processSprintAssignment,
  getItemSprint,
  getCurrentSprint
};
