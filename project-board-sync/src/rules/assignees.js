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
      item: node(id: $itemId) {
        ... on ProjectV2Item {
          fieldValues(first: 10) {
            nodes {
              ... on ProjectV2ItemFieldUserValue {
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
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @returns {Promise<{changed: boolean, assignees: string[]}>}
 */
async function processAssignees(item, projectId, itemId) {
  // Get current assignees in project
  const currentAssignees = await getItemAssignees(projectId, itemId);
  
  // For PRs authored by monitored user, always add author as assignee
  if (item.__typename === 'PullRequest' && item.author?.login === process.env.GITHUB_AUTHOR) {
    const targetAssignees = new Set([
      ...item.assignees.nodes.map(a => a.login), // Keep existing assignees
      item.author.login // Add author
    ]);

    // Convert Set back to array for comparison
    const targetAssigneeArray = Array.from(targetAssignees);

    // Compare current with target assignees
    const changed = !arraysEqual(currentAssignees, targetAssigneeArray);
    
    if (changed) {
      await setItemAssignees(projectId, itemId, targetAssigneeArray);
    }

    return {
      changed,
      assignees: targetAssigneeArray,
      reason: changed ? 'Added PR author as assignee' : 'Author already assigned'
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
