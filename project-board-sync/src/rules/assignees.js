const { octokit } = require('../github/api');
const { log } = require('../utils/log');

/**
 * Get details about a project item including its linked content
 * @param {string} itemId - The project item ID
 * @returns {Promise<Object>} Item details including repository info
 */
async function getItemDetails(itemId) {
  try {
    const result = await octokit.graphql(`
      query($itemId: ID!) {
        node(id: $itemId) {
          ... on ProjectV2Item {
            id
            type
            content {
              ... on Issue {
                id
                number
                repository {
                  nameWithOwner
                }
              }
              ... on PullRequest {
                id
                number
                repository {
                  nameWithOwner
                }
              }
            }
          }
        }
      }
    `, {
      itemId
    });
    
    return result.node;
  } catch (error) {
    log.error(`Failed to get item details: ${error.message}`);
    return null;
  }
}

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
  // First get user IDs from logins
  const userIdsResult = await Promise.all(
    assigneeLogins.map(async (login) => {
      const result = await octokit.graphql(`
        query($login: String!) {
          user(login: $login) {
            id
          }
        }
      `, { login });
      return result.user.id;
    })
  );

  try {
    // Get item details to get the repository name and issue/PR number
    const itemDetails = await getItemDetails(itemId);
    
    if (!itemDetails || !itemDetails.content) {
      throw new Error(`Could not get details for item ${itemId}`);
    }
    
    const { repository, number } = itemDetails.content;
    if (!repository || !repository.nameWithOwner) {
      throw new Error(`Repository information not available for item ${itemId}`);
    }
    
    // Use REST API to set assignees directly on the issue/PR
    // Parse the owner/repo from nameWithOwner (format: "owner/repo")
    const [owner, repo] = repository.nameWithOwner.split('/');
    
    log.info(`Setting assignees for ${repository.nameWithOwner}#${number} to: ${assigneeLogins.join(', ')}`, true);
    
    // For a PR
    if (itemDetails.type === 'PullRequest') {
      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: number,
        assignees: assigneeLogins
      });
    } 
    // For an Issue
    else {
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: number,
        assignees: assigneeLogins
      });
    }
    
    log.info(`Successfully updated assignees for ${repository.nameWithOwner}#${number} using REST API`, true);
  } catch (error) {
    log.error(`Failed to update assignees: ${error.message}`, true);
    throw new Error(`Failed to update assignees: ${error.message}`);
  }
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
  const currentAssignees = await getItemAssignees(projectId, itemId);
  
  // For PRs authored by monitored user, ensure they are assigned
  // Support both GraphQL objects (item.__typename) and REST API objects (item.type)
  const isPullRequest = item.__typename === 'PullRequest' || item.type === 'PullRequest';
  const authorLogin = item.author?.login || item.user?.login;
  
  if (isPullRequest && authorLogin === process.env.GITHUB_AUTHOR) {
    log.info(`Processing assignees for PR #${item.number}:`, true);
    log.info(`  • Author: ${authorLogin}`, true);
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

    // Author is not assigned, so add them while preserving any existing assignees
    const targetAssignees = [...new Set([...currentAssignees, item.author.login])];
    log.info(`  • Setting assignees: ${targetAssignees.join(', ')}`, true);

    // Set assignees both in project and in the actual PR/Issue
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
  setItemAssignees,
  getItemDetails
};
