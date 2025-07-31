const { Octokit } = require('@octokit/rest');
const { graphql } = require('@octokit/graphql');
const { log } = require('../utils/log');

/**
 * GitHub API client setup
 */
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Create authenticated GraphQL client with debug logging
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `bearer ${process.env.GITHUB_TOKEN}`,
  },
  request: {
    fetch: (url, options) => {
      log.debug('GraphQL Request:', JSON.stringify(options.body, null, 2));
      return fetch(url, options).then(response => {
        log.debug('GraphQL Response:', response.status);
        return response;
      });
    }
  }
});

// Cache field IDs per project to reduce API calls
const fieldIdCache = new Map();

// Cache for column option IDs
const columnOptionIdCache = new Map();

// Cache project items during a single run
const projectItemsCache = new Map();

/**
 * Get the column option ID for a given column name
 * @param {string} projectId - The project board ID
 * @param {string} columnName - The name of the column (Status field option)
 * @returns {Promise<string|null>} The column option ID or null if not found
 */
async function getColumnOptionId(projectId, columnName) {
  // Create a composite cache
  const cacheKey = `${projectId}:${columnName}`;

  // Check if we have this column option ID cached
  if (columnOptionIdCache.has(cacheKey)) {
    return columnOptionIdCache.get(cacheKey);
  }
  try {
    // Get all column options by field name (Status)
    const result = await graphqlWithAuth(`
      query($projectId: ID!, $fieldName: String!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            field(name: $fieldName) {
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
    `, {
      projectId,
      fieldName: 'Status'
    });
    // Find the option with matching name
    const options = result.node.field.options;
    const option = options.find(opt => opt.name === columnName);
    if (option) {
      // Cache the result
      columnOptionIdCache.set(cacheKey, option.id);
      return option.id;
    }
    log.error(`Column option "${columnName}" not found in project ${projectId}`);
    return null;
  } catch (error) {
    log.error(`Failed to get column option ID for ${columnName}: ${error.message}`);
    return null;
  }
}

/**
 * Get all items from a project board with caching
 */
async function getProjectItems(projectId) {
  if (projectItemsCache.has(projectId)) {
    return projectItemsCache.get(projectId);
  }

  const items = new Map();
  let hasNextPage = true;
  let endCursor = null;
  let totalItems = 0;

  while (hasNextPage && totalItems < 300) { // Safety limit
    const result = await graphqlWithAuth(`
      query($projectId: ID!, $cursor: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $cursor) {
              nodes {
                id
                content {
                  ... on PullRequest {
                    id
                  }
                  ... on Issue {
                    id
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `, {
      projectId,
      cursor: endCursor
    });

    const projectItems = result.node?.items?.nodes || [];
    totalItems += projectItems.length;

    for (const item of projectItems) {
      if (item.content?.id) {
        items.set(item.content.id, item.id);
      }
    }

    hasNextPage = result.node?.items?.pageInfo?.hasNextPage || false;
    endCursor = result.node?.items?.pageInfo?.endCursor;
  }

  projectItemsCache.set(projectId, items);
  return items;
}

/**
 * Check if an item is already in the project board
 * @param {string} nodeId - The node ID of the item (PR or Issue)
 * @param {string} projectId - The project board ID
 * @returns {Promise<{isInProject: boolean, projectItemId?: string}>} - Whether the item is in the project and its project item ID if found
 */
async function isItemInProject(nodeId, projectId) {
  try {
    // First check the cache
    const projectItems = await getProjectItems(projectId, true);
    const projectItemId = projectItems.get(nodeId);

    // If found in cache, return immediately
    if (projectItemId) {
      return {
        isInProject: true,
        projectItemId
      };
    }

    // If not in cache, query the project items directly
    const result = await graphqlWithAuth(`
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on PullRequest {
                    id
                  }
                  ... on Issue {
                    id
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

    // Find the item that matches our nodeId
    const matchingItem = result.node?.items?.nodes?.find(item =>
      item.content?.id === nodeId
    );

    if (matchingItem) {
      // Update cache with the found item
      projectItems.set(nodeId, matchingItem.id);
      return {
        isInProject: true,
        projectItemId: matchingItem.id
      };
    }

    return { isInProject: false };

  } catch (error) {
    log.error(`Failed to check if item ${nodeId} is in project: ${error.message}`);
    throw error;
  }
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
 * Get recent items (PRs and Issues) from monitored repositories and authored by monitored user
 * @param {string} org - Organization name
 * @param {Array<string>} repos - List of repository names
 * @param {string} monitoredUser - GitHub username to monitor
 * @returns {Promise<Array>} - List of items (PRs and Issues)
 */
async function getRecentItems(org, repos, monitoredUser) {
  // Calculate 24 hours ago in ISO format
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Search for items in monitored repositories
  const repoQueries = repos.map(repo => `repo:${org}/${repo} updated:>${since}`);
  const repoSearchQuery = repoQueries.join(' ');
  
  // Search for PRs authored by monitored user in ANY repository
  const authorSearchQuery = `author:${monitoredUser} updated:>${since}`;

  const results = [];

  // Get items from monitored repositories
  if (repoSearchQuery) {
    const repoResult = await graphqlWithAuth(`
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
      searchQuery: repoSearchQuery
    });
    
    results.push(...repoResult.search.nodes);
  }

  // Get PRs authored by monitored user in any repository
  const authorResult = await graphqlWithAuth(`
    query($searchQuery: String!) {
      search(query: $searchQuery, type: ISSUE, first: 100) {
        nodes {
          __typename
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
    searchQuery: authorSearchQuery
  });
  
  results.push(...authorResult.search.nodes);

  // Remove duplicates based on item ID
  const seen = new Set();
  return results.filter(item => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
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
async function setItemColumn(projectId, projectItemId, optionId) {
  // Get Status field ID from cache
  const statusFieldId = await getFieldId(projectId, 'Status');

  const mutation = `
    mutation UpdateColumnValue($input: UpdateProjectV2ItemFieldValueInput!) {
      updateProjectV2ItemFieldValue(input: $input) {
        projectV2Item {
          id
          project {
            id
            number
          }
        }
      }
    }
  `;

  const input = {
    projectId: projectId,
    itemId: projectItemId,
    fieldId: statusFieldId,
    value: {
      singleSelectOptionId: optionId,
    },
  };

  try {
    const result = await graphqlWithAuth(mutation, { input });
    if (!result.updateProjectV2ItemFieldValue || !result.updateProjectV2ItemFieldValue.projectV2Item) {
      log.error(`[API] setItemColumn: No projectV2Item returned for itemId=${projectItemId}, projectId=${projectId}, optionId=${optionId}`);
      log.error(`[API] setItemColumn: Full response: ${JSON.stringify(result)}`);
      throw new Error('setItemColumn: No projectV2Item in response');
    }
    log.info(`[API] setItemColumn: Successfully set column for itemId=${projectItemId} to optionId=${optionId}`);
    return result;
  } catch (error) {
    log.error(`[API] setItemColumn: Failed to set column for itemId=${projectItemId}, projectId=${projectId}, optionId=${optionId}`);
    log.error(`[API] setItemColumn: Error: ${error.stack || error}`);
    throw error;
  }
}

/**
 * Get field ID with caching
 * @param {string} projectId - The project board ID
 * @param {string} fieldName - The name of the field
 * @returns {Promise<string>} The field ID
 */
async function getFieldId(projectId, fieldName) {
  // Use composite key for cache
  const cacheKey = `${projectId}:${fieldName}`;

  if (fieldIdCache.has(cacheKey)) {
    log.debug(`Using cached field ID for ${fieldName} in project ${projectId}`);
    return fieldIdCache.get(cacheKey);
  }

  log.debug(`Fetching field ID for ${fieldName} in project ${projectId}`);
  const result = await graphqlWithAuth(`
    query($projectId: ID!, $fieldName: String!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          field(name: $fieldName) {
            ... on ProjectV2Field {
              id
            }
            ... on ProjectV2SingleSelectField {
              id
            }
          }
        }
      }
    }
  `, { projectId, fieldName });

  if (!result.node.field || !result.node.field.id) {
    throw new Error(`Field '${fieldName}' not found in project or doesn't have an ID`);
  }

  const fieldId = result.node.field.id;
  fieldIdCache.set(cacheKey, fieldId);
  return fieldId;
}

module.exports = {
  octokit,
  graphql: graphqlWithAuth,
  isItemInProject,
  addItemToProject,
  getRecentItems,
  getItemColumn,
  setItemColumn,
  getFieldId,
  getColumnOptionId
};
