const { Octokit } = require('@octokit/rest');

/**
 * GitHub API client setup
 */
const octokit = new Octokit({
  auth: process.env.GH_TOKEN
});

/**
 * Check if an item is already in the project board
 * @param {string} nodeId - The node ID of the item (PR or Issue)
 * @param {string} projectId - The project board ID
 * @returns {Promise<{isInProject: boolean, projectItemId?: string}>} - Whether the item is in the project and its project item ID if found
 */
async function isItemInProject(nodeId, projectId) {
  const result = await octokit.graphql(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100) {
            nodes {
              id
              content {
                ... on Issue { id }
                ... on PullRequest { id }
              }
            }
          }
        }
      }
    }
  `, {
    projectId
  });

  const matchingItem = result.node.items.nodes.find(item => 
    item.content && item.content.id === nodeId
  );

  return {
    isInProject: !!matchingItem,
    projectItemId: matchingItem?.id
  };
}

/**
 * Add an item to the project board
 * @param {string} nodeId - The node ID of the item (PR or Issue)
 * @param {string} projectId - The project board ID
 * @returns {Promise<string>} - The project item ID
 */
async function addItemToProject(nodeId, projectId) {
  const result = await octokit.graphql(`
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {
        projectId: $projectId,
        contentId: $contentId
      }) {
        item {
          id
        }
      }
    }
  `, {
    projectId,
    contentId: nodeId
  });

  if (!result.addProjectV2ItemById?.item?.id) {
    throw new Error('Failed to add item to project - missing item ID in response');
  }

  return result.addProjectV2ItemById.item.id;
}

/**
 * Get items updated in the last 24 hours for monitored repositories
 * @param {string} org - The GitHub organization
 * @param {string[]} repos - List of repository names to monitor
 * @param {string} monitoredUser - The GitHub username to monitor
 * @returns {Promise<Array>} - List of items (PRs and Issues)
 */
async function getRecentItems(org, repos, monitoredUser) {
  // Calculate 24 hours ago in ISO format
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const queries = repos.map(repo => `
    repo:${org}/${repo} updated:>${since}
  `);
  
  const searchQuery = queries.join(' ');
  
  const result = await octokit.graphql(`
    query($searchQuery: String!) {
      search(query: $searchQuery, type: ISSUE, first: 100) {
        nodes {
          __typename
          ... on Issue {
            id
            number
            repository { nameWithOwner }
            assignees(first: 5) { nodes { login } }
            updatedAt
          }
          ... on PullRequest {
            id
            number
            repository { nameWithOwner }
            author { login }
            assignees(first: 5) { nodes { login } }
            updatedAt
          }
        }
      }
    }
  `, {
    searchQuery
  });

  // Filter items based on monitored conditions
  return result.search.nodes.filter(item => {
    // Keep issues from monitored repos
    if (item.__typename === 'Issue') {
      return true;
    }
    
    // For PRs, check author and assignees
    if (item.__typename === 'PullRequest') {
      const isAuthor = item.author?.login === monitoredUser;
      const isAssignee = item.assignees.nodes.some(a => a.login === monitoredUser);
      return isAuthor || isAssignee || true; // true for monitored repos
    }
    
    return false;
  });
}

/**
 * Get the current column (Status field) for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @returns {Promise<string|null>} - The current column name or null
 */
async function getItemColumn(projectId, itemId) {
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
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
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

  const fieldValues = result.node.items.nodes[0]?.fieldValues.nodes || [];
  const statusValue = fieldValues.find(value => 
    value.field && value.field.name === 'Status'
  );
  
  return statusValue ? statusValue.name : null;
}

/**
 * Set the column (Status field) for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @param {string} columnName - The name of the column to set
 * @returns {Promise<void>}
 */
async function setItemColumn(projectId, itemId, columnName) {
  // First get the field ID and option ID
  const result = await octokit.graphql(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `, {
    projectId
  });

  const statusField = result.node.fields.nodes.find(
    field => field.name === "Status"
  );

  if (!statusField) {
    throw new Error('Status field not found in project');
  }

  const fieldId = statusField.id;
  const optionId = statusField.options.find(
    opt => opt.name === columnName
  )?.id;

  if (!optionId) {
    throw new Error(`Column "${columnName}" not found in project's Status field options`);
  }

  // Now set the column
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
    fieldId,
    optionId
  });
}

/**
 * Set the sprint for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @param {string} sprintId - The iteration ID of the sprint to set
 * @returns {Promise<void>}
 */
async function setItemSprint(projectId, itemId, sprintId) {
  // First get the field ID for Sprint/Iteration field
  const result = await octokit.graphql(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2IterationField {
                id
                name
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
      }
    }
  `, {
    projectId
  });

  const sprintField = result.node.fields.nodes.find(
    field => field.name === "Sprint" || field.name === "Iteration"
  );

  if (!sprintField) {
    throw new Error('Sprint/Iteration field not found in project');
  }

  const fieldId = sprintField.id;
  const sprintExists = sprintField.configuration.iterations.some(it => it.id === sprintId);

  if (!sprintExists) {
    throw new Error(`Sprint with ID "${sprintId}" not found in project's iterations`);
  }

  // Now set the sprint
  await octokit.graphql(`
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { 
          iterationId: $iterationId
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
    iterationId: sprintId
  });
}

module.exports = {
  isItemInProject,
  addItemToProject,
  getRecentItems,
  getItemColumn,
  setItemColumn,
  setItemSprint
};
