/**
 * Mock implementations for GitHub API
 */
const mockData = {
  items: new Map(),
  projectItems: new Map(),
  shouldFail: false,
  lastId: 0
};

/**
 * Reset all mock data
 */
function resetMocks() {
  mockData.items.clear();
  mockData.projectItems.clear();
  mockData.shouldFail = false;
  mockData.lastId = 0;
}

/**
 * Mock isItemInProject implementation
 * @param {string} nodeId - ID of the item to check
 * @param {string} projectId - ID of the project
 * @returns {Promise<{isInProject: boolean, projectItemId?: string}>}
 */
async function isItemInProject(nodeId, projectId) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: isItemInProject failed');
  }

  const key = `${projectId}:${nodeId}`;
  const isInProject = mockData.projectItems.has(key);
  return {
    isInProject,
    projectItemId: isInProject ? mockData.projectItems.get(key) : undefined
  };
}

/**
 * Mock addItemToProject implementation
 * @param {string} nodeId - ID of the item to add
 * @param {string} projectId - ID of the project
 * @returns {Promise<string>} Project item ID
 */
async function addItemToProject(nodeId, projectId) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: addItemToProject failed');
  }

  const key = `${projectId}:${nodeId}`;
  if (mockData.projectItems.has(key)) {
    throw new Error('Mock API Error: Item already in project');
  }

  mockData.lastId++;
  const projectItemId = `project-item-${mockData.lastId}`;
  mockData.projectItems.set(key, projectItemId);
  return projectItemId;
}

/**
 * Mock getRecentItems implementation
 * @param {string} org - GitHub organization
 * @param {string[]} repos - Repository names
 * @param {string} monitoredUser - GitHub username being monitored
 * @returns {Promise<Array>} List of items
 */
async function getRecentItems(org, repos, monitoredUser) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: getRecentItems failed');
  }
  return Array.from(mockData.items.values());
}

/**
 * Add a test item to the mock data
 * @param {Object} item - The item to add
 */
function addMockItem(item) {
  if (!item || !item.id) {
    throw new Error('Mock API Error: Invalid item');
  }
  mockData.items.set(item.id, item);
}

/**
 * Set whether mock API calls should fail
 * @param {boolean} shouldFail - Whether API calls should throw errors
 */
function setMockFailure(shouldFail) {
  mockData.shouldFail = shouldFail;
}

module.exports = {
  isItemInProject,
  addItemToProject,
  getRecentItems,
  resetMocks,
  addMockItem,
  setMockFailure
};
