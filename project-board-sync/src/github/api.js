const { Octokit } = require('@octokit/rest');
const { graphql } = require('@octokit/graphql');

/**
 * GitHub API client setup
 */
const octokit = new Octokit({
  auth: process.env.GH_TOKEN
});

// Create authenticated GraphQL client
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `bearer ${process.env.GH_TOKEN}`,
  },
});

/**
 * Check if an item is already in the project board
 * @param {string} nodeId - The node ID of the item (PR or Issue)
 * @param {string} projectId - The project board ID
 * @returns {Promise<{isInProject: boolean, projectItemId?: string}>} - Whether the item is in the project and its project item ID if found
 */
async function isItemInProject(nodeId, projectId) {
  const result = await graphqlWithAuth(`
    query($projectId: ID!, $nodeId: ID!) {
      project: node(id: $projectId) {
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
      node: node(id: $nodeId) {
        ... on Issue { id }
        ... on PullRequest { id }
      }
    }
  `, {
    projectId,
    nodeId
  });

  const matchingItem = result.project.items.nodes.find(item => 
    item.content && item.content.id === result.node.id
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
  const result = await graphqlWithAuth(`
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
  
  const queries = repos.map(repo => `repo:${org}/${repo} updated:>${since}`);
  const searchQuery = queries.join(' ');
  
  const result = await graphqlWithAuth(`
    query($searchQuery: String!) {
      search(query: $searchQuery, type: ISSUE, first: 100) {
        nodes {
          __typename
          ... on Issue {
            id
            number
            repository { nameWithOwner }
            author { login }
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

  return result.search.nodes;
}

/**
 * Get the current column (Status field) for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @returns {Promise<string|null>} - The current column name or null
 */
async function getItemColumn(projectId, itemId) {
  const result = await graphqlWithAuth(`
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
        }
      }
      item: node(id: $itemId) {
        ... on ProjectV2Item {
          fieldValues(first: 10) {
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
  `, {
    projectId,
    itemId
  });

  const fieldValues = result.item?.fieldValues.nodes || [];
  const statusValue = fieldValues.find(value => 
    value.field && value.field.name === 'Status'
  );
  
  return statusValue ? statusValue.name : null;
}

/**
 * Set the column (Status field) for a project item
 * @param {string} projectId - The project board ID
 * @param {string} itemId - The project item ID
 * @param {string} optionId - The status option ID to set
 * @returns {Promise<void>}
 */
async function setItemColumn(projectId, itemId, optionId) {
  const result = await graphqlWithAuth(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          field(name: "Status") {
            ... on ProjectV2SingleSelectField {
              id
            }
          }
        }
      }
    }
  `, {
    projectId
  });

  const fieldId = result.node.field.id;

  await graphqlWithAuth(`
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

module.exports = {
  octokit,
  graphql: graphqlWithAuth,
  isItemInProject,
  addItemToProject,
  getRecentItems,
  getItemColumn,
  setItemColumn
};
