const { octokit } = require('../github/api');
const { log } = require('../utils/log');

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
              ... on ProjectV2Assignees {
                id
                name
              }
            }
          }
          items(first: 1, filter: { id: $itemId }) {
            nodes {
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
      }
    }
  `, {
    projectId,
    itemId
  });

  const assigneeValues = result.node.items.nodes[0]?.fieldValues.nodes || [];
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
              ... on ProjectV2Assignees {
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
  
  // If already has assignees, no need to change
  if (currentAssignees.length > 0) {
    return {
      changed: false,
      assignees: currentAssignees,
      reason: 'Already has assignees'
    };
  }

  // For PRs, assign to author if no assignees
  if (item.__typename === 'PullRequest' && item.author) {
    await setItemAssignees(projectId, itemId, [item.author.login]);
    return {
      changed: true,
      assignees: [item.author.login],
      reason: 'Assigned to PR author'
    };
  }

  return {
    changed: false,
    assignees: [],
    reason: 'No default assignee determined'
  };
}

module.exports = {
  processAssignees,
  getItemAssignees,
  setItemAssignees
};
