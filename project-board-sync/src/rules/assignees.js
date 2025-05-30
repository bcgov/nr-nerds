const { octokit } = require('../github/api');
const { log } = require('../utils/log');

/**
 * Compare two arrays for equality
 * @param {Array} a - First array
 * @param {Array} b - Second array
 * @returns {boolean}
 */
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Get assignees for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @returns {Promise<string[]>} Array of assignee logins
 */
async function getItemAssignees(projectId, itemId) {
  const result = await octokit.graphql(`
    query($projectId: ID!, $itemId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          field(name: "Assignees") {
            ... on ProjectV2Field {
              id
            }
          }
        }
      }
      item: node(id: $itemId) {
        ... on ProjectV2Item {
          fieldValues(first: 10) {
            nodes {
              ... on ProjectV2ItemFieldUserValue {
                field {
                  ... on ProjectV2Field {
                    name
                  }
                }
                users(first: 10) {
                  nodes {
                    login
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

  const assigneeValues = result.item?.fieldValues.nodes || [];
  const assignees = assigneeValues.flatMap(value => 
    value.users?.nodes?.map(user => user.login) || []
  );

  return assignees;
}

/**
 * Set assignees for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @param {string[]} assigneeLogins - GitHub usernames to assign
 * @returns {Promise<void>}
 */
async function setItemAssignees(projectId, itemId, assigneeLogins) {
  // First get the assignees field ID
  const result = await octokit.graphql(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `, {
    projectId
  });

  const assigneesField = result.node.fields.nodes.find(
    field => field.name === "Assignees"
  );

  if (!assigneesField) {
    throw new Error('Assignees field not found in project');
  }

  const fieldId = assigneesField.id;

  // Now set the assignees
  await octokit.graphql(`
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $userIds: [String!]!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { 
          userIds: $userIds
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
    fieldId,
    userIds: assigneeLogins
  });
}

/**
 * Implementation of Rule Set 5: Assignee Rules
 * 
 * Rules:
 * - PRs should have at least one assignee
 * - If no assignee is set, assign to PR author
 * - Linked issues inherit assignees from their linked PRs
 * 
 * @param {Object} item - The PR or Issue
 * @param {string} item.id - The item's node ID
 * @param {string} item.__typename - The type of item ('PullRequest' or 'Issue')
 * @param {number} item.number - The PR or issue number
 * @param {Object} item.author - The author information
 * @param {string} item.author.login - The author's GitHub username
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @returns {Promise<{changed: boolean, assignees: string[], reason: string}>}
 */
async function processAssignees(item, projectId, itemId) {
  // Get current assignees in project
  const currentAssignees = await getItemAssignees(projectId, itemId);    // For PRs authored by monitored user, ensure they are assigned
  if (item.__typename === 'PullRequest' && item.author?.login === process.env.GITHUB_AUTHOR) {
    log.info(`Processing assignees for PR #${item.number}:`, true);
    log.info(`  • Author: ${item.author.login}`, true);
    log.info(`  • Current assignees: ${currentAssignees.join(', ') || 'none'}`, true);

    // Check if author is already assigned (in project board)
    if (currentAssignees.includes(item.author.login)) {
      log.info('  • Author already assigned - skipping', true);
      return {
        changed: false,
        assignees: currentAssignees,
        reason: 'Author already assigned'
      };
    }

    // Author is not assigned, so add them
    const targetAssignees = [item.author.login];
    log.info(`  • Adding author as assignee: ${item.author.login}`, true);

    // Set assignees in project
    await setItemAssignees(projectId, itemId, targetAssignees);

    return {
      changed: true,
      assignees: targetAssignees,
      reason: 'Added PR author as assignee'
    };
  }

  return {
    changed: false,
    assignees: currentAssignees,
    reason: 'No assignee changes needed'
  };
}

module.exports = {
  processAssignees,
  getItemAssignees,
  setItemAssignees
};
