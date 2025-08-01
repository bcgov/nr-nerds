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
  log.info('Getting current sprint:');
  log.info(`  • Current date: ${today}`);
  
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
  log.info(`  • Found ${iterations.length} sprints`);
  
  const currentSprint = iterations.find(sprint => {
    const start = new Date(sprint.startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + sprint.duration);
    const now = new Date();
    const isCurrentSprint = now >= start && now < end;
    log.debug(`  • Sprint "${sprint.title}": ${start.toISOString()} to ${end.toISOString()} - ${isCurrentSprint ? 'CURRENT' : 'not current'}`);
    return isCurrentSprint;
  });

  if (!currentSprint) {
    log.error('  • No active sprint found matching current date');
    throw new Error('No active sprint found');
  }

  log.info(`  • Current sprint: ${currentSprint.title} (${currentSprint.id})`);
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
  log.info(`Processing sprint assignment for ${item.__typename} #${item.number}:`);
  log.info(`  • Current column: ${currentColumn}`);

  // Only process items in Next, Active, Done, or Waiting columns
  if (!ELIGIBLE_COLUMNS.includes(currentColumn)) {
    log.info(`  • Skip: Not in Next, Active, Done, or Waiting column (${currentColumn})`);
    return { 
      changed: false, 
      reason: 'Not in Next, Active, Done, or Waiting column' 
    };
  }

  // Get current sprint assignment
  const { sprintId: currentSprintId, sprintTitle: currentSprintTitle } = 
    await getItemSprint(projectId, projectItemId);
  log.info(`  • Current sprint: ${currentSprintTitle || 'None'} (${currentSprintId || 'None'})`);

  // Get active sprint
  try {
    const { sprintId: activeSprintId, title: activeSprintTitle } = 
      await getCurrentSprint(projectId);
    log.info(`  • Active sprint: ${activeSprintTitle} (${activeSprintId})`);

    // Check skip conditions - different rules for Done vs Active/Next
    if (currentColumn === 'Done') {
      // For Done: skip if ANY sprint is set
      if (currentSprintId) {
        log.info(`  • Skip: Item in Done has a sprint set (${currentSprintTitle})`);
        return {
          changed: false,
          reason: `Item in Done has sprint set (${currentSprintTitle})`
        };
      }
    }
    // For Active/Next: No skip conditions - always set to current sprint

    // Get the Sprint field ID
    const sprintFieldResult = await octokit.graphql(`
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            field(name: "Sprint") {
              ... on ProjectV2IterationField {
                id
              }
            }
          }
        }
      }
    }`, { projectId });
    
    const sprintFieldId = sprintFieldResult.node.field.id;
    log.info(`  • Action: Assigning to sprint ${activeSprintTitle}`);
    
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
      fieldId: sprintFieldId,
      iterationId: activeSprintId
    });

    return {
      changed: true,
      newSprint: activeSprintId,
      reason: `Assigned to current sprint (${activeSprintTitle})`
    };

  } catch (error) {
    log.error(`  • Error: Failed to process sprint assignment: ${error.message}`);
    log.error(error.stack);
    throw error;
  }
}

module.exports = {
  processSprintAssignment,
  getItemSprint,
  getCurrentSprint
};
