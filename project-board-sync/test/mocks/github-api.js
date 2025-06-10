/**
 * @fileoverview Mock GitHub API functions for testing
 */

/**
 * Mock state that simulates GitHub's API responses
 */
const mockState = {
  // Project items in a cache-like structure
  projectItems: new Map(),

  // Mock responses that can be customized per test
  responses: {
    columnOptionId: 'mock-column-id',
    inProject: true,
    projectItemId: 'mock-project-item-id',
    column: 'Active',
    assignees: ['test-user'],
    projectItems: {
      nodes: [],
      pageInfo: {
        hasNextPage: false,
        endCursor: null
      }
    }
  }
};

/**
 * Mock getColumnOptionId function
 */
async function getColumnOptionId(projectId, columnName) {
  return mockState.responses.columnOptionId;
}

/**
 * Mock getProjectItems GraphQL query
 */
async function getProjectItems(projectId) {
  return mockState.responses.projectItems;
}

/**
 * Mock isItemInProject function
 * Now returns mocked response directly without calling actual GitHub API
 */
async function isItemInProject(nodeId, projectId) {
  // If test is expecting a specific response, use that
  if (mockState.responses.isItemInProject !== undefined) {
    return {
      isInProject: mockState.responses.isItemInProject,
      projectItemId: mockState.responses.projectItemId
    };
  }

  // Default behavior
  return {
    isInProject: true,
    projectItemId: 'mock-project-item-id'
  };
}

/**
 * Mock getItemColumn function
 */
async function getItemColumn(projectId, projectItemId) {
  // Return cached value if one exists
  const cached = mockState.projectItems.get(projectItemId)?.column;
  if (cached) return cached;

  // Otherwise return mock response
  return mockState.responses.column;
}

/**
 * Mock getItemDetails function
 */
async function getItemDetails(item) {
  return {
    assignees: [],
    repository: {
      name: 'test-repo',
      owner: 'test-owner'
    }
  };
}

/**
 * Mock getItemAssignees function
 */
async function getItemAssignees(projectId, projectItemId) {
  // Return cached value if one exists
  const cached = mockState.projectItems.get(projectItemId)?.assignees;
  if (cached) return cached;

  // Otherwise return mock response
  return mockState.responses.assignees;
}

/**
 * Allow test files to set custom mock responses
 */
function setMockResponse(key, value) {
  mockState.responses[key] = value;
}

/**
 * Add a mock project item
 */
function addMockProjectItem(projectItemId, { column, assignees } = {}) {
  mockState.projectItems.set(projectItemId, {
    column: column || 'Active',
    assignees: assignees || []
  });
}

/**
 * Reset all mock state to defaults
 */
function resetMockResponses() {
  mockState.projectItems.clear();
  mockState.responses = {
    columnOptionId: 'mock-column-id',
    inProject: true,
    projectItemId: 'mock-project-item-id',
    column: 'Active',
    assignees: ['test-user'],
    projectItems: {
      nodes: [],
      pageInfo: {
        hasNextPage: false,
        endCursor: null
      }
    }
  };
}

// Export mock functions and utilities
module.exports = {
  getColumnOptionId,
  getProjectItems,
  isItemInProject,
  getItemColumn,
  getItemDetails,
  getItemAssignees,
  setMockResponse,
  addMockProjectItem,
  resetMockResponses
};
