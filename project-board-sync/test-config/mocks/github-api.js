/**
 * Mock implementations for GitHub API
 */
const mockData = {
  items: new Map(),
  projectItems: new Map(),
  itemColumns: new Map(),
  itemSprints: new Map(),
  itemAssignees: new Map(),
  shouldFail: false,
  lastId: 0,
  sprints: [
    {
      id: 'sprint-1',
      title: 'Sprint 15',  // May 15-28
      startDate: '2025-05-15T00:00:00Z',
      duration: 14
    },
    {
      id: 'sprint-2',
      title: 'Sprint 16',  // May 29-Jun 11
      startDate: '2025-05-29T00:00:00Z',
      duration: 14
    },
    {
      id: 'sprint-3',
      title: 'Sprint 17',  // Jun 12-25
      startDate: '2025-06-12T00:00:00Z',
      duration: 14
    }
  ]
};

/**
 * Reset all mock data
 */
function resetMocks() {
  mockData.items.clear();
  mockData.projectItems.clear();
  mockData.itemColumns.clear();
  mockData.itemSprints.clear();
  mockData.itemAssignees.clear();
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
 * Mock setItemColumn implementation
 */
async function setItemColumn(projectItemId, columnId) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: setItemColumn failed');
  }
  mockData.itemColumns.set(projectItemId, columnId);
  return { success: true };
}

/**
 * Mock setItemSprint implementation
 */
async function setItemSprint(projectItemId, sprintId) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: setItemSprint failed');
  }
  mockData.itemSprints.set(projectItemId, sprintId);
  return { success: true };
}

/**
 * Mock setItemAssignees implementation
 */
async function setItemAssignees(projectItemId, assigneeIds) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: setItemAssignees failed');
  }
  mockData.itemAssignees.set(projectItemId, assigneeIds);
  return { success: true };
}

/**
 * Mock getItemDetails implementation
 */
async function getItemDetails(projectItemId) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: getItemDetails failed');
  }
  return {
    column: mockData.itemColumns.get(projectItemId) || null,
    sprint: mockData.itemSprints.get(projectItemId) || null,
    assignees: mockData.itemAssignees.get(projectItemId) || []
  };
}

/**
 * Mock column options for the project
 */  const mockColumnOptions = [
  { id: 'col-1', name: 'New' },
  { id: 'col-2', name: 'Active' },
  { id: 'col-3', name: 'Done' },
  { id: 'col-1-lower', name: 'new' },      // Lowercase variants
  { id: 'col-2-lower', name: 'active' },
  { id: 'col-3-lower', name: 'done' }
];

/**
 * Mock getItemColumn implementation
 */
async function getItemColumn(projectId, itemId) {
  // Return a mock column name based on state if available
  const item = mockData.items.get(itemId);
  if (item?.state === 'CLOSED' || item?.state === 'MERGED') {
    return 'Done';
  }
  return mockData.itemColumns.get(itemId) || null;
}

/**
 * Mock graphql implementation
 */
async function graphql(query, variables) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: graphql failed');
  }

  // Project field values query (for getting assignees)
  if (query.includes('fieldValues(first: 10)')) {
    const { itemId } = variables;
    const assignees = mockData.itemAssignees.get(itemId) || [];
    return {
      node: {
        fields: {
          nodes: [{
            id: 'assignee-field-1',
            name: 'Assignees'
          }]
        }
      },
      item: {
        fieldValues: {
          nodes: [{
            users: {
              nodes: assignees.map(login => ({ login }))
            }
          }]
        }
      }
    };
  }

  // Get project fields query (for getting assignee field ID)
  if (query.includes('fields(first: 20)') && !query.includes('fieldValues')) {
    return {
      node: {
        fields: {
          nodes: [{
            id: 'assignee-field-1',
            name: 'Assignees'
          }]
        }
      }
    };
  }

  // Update field value mutation
  if (query.includes('updateProjectV2ItemFieldValue')) {
    const { itemId, userIds } = variables;
    mockData.itemAssignees.set(itemId, userIds);
    return {
      updateProjectV2ItemFieldValue: {
        projectV2Item: {
          id: itemId
        }
      }
    };
  }

  // Get sprint field and item sprint value
  if (query.includes('field(name: "Sprint")')) {
    const { itemId } = variables;
    const currentSprint = mockData.itemSprints.get(itemId) || null;
    return {
      node: {
        field: {
          id: 'sprint-field-1',
          configuration: {
            iterations: [
              mockData.sprints.current,
              mockData.sprints.next
            ]
          }
        }
      },
      item: {
        fieldValues: {
          nodes: currentSprint ? [{
            iterationId: currentSprint.id,
            title: currentSprint.title
          }] : []
        }
      }
    };
  }

  // Get current sprint
  if (query.includes('iterations(first: 20)')) {
    return {
      node: {
        field: {
          id: 'sprint-field-1',
          configuration: {
            iterations: [
              mockData.sprints.current,
              mockData.sprints.next
            ]
          }
        }
      }
    };
  }

  // Set sprint value mutation
  if (query.includes('updateProjectV2ItemFieldValue') && query.includes('iterationId')) {
    const { itemId, value } = variables;
    const sprintId = value.iterationId;
    const sprint = Object.values(mockData.sprints).find(s => s.id === sprintId);
    if (sprint) {
      mockData.itemSprints.set(itemId, sprint);
    }
    return {
      updateProjectV2ItemFieldValue: {
        projectV2Item: {
          id: itemId
        }
      }
    };
  }

  // Match specific known queries
  if (query.includes('field(name: "Status")')) {
    return {
      node: {
        field: {
          options: mockColumnOptions
        }
      }
    };
  }

  // If no match found, throw error with query for debugging
  throw new Error(`Mock API Error: Unhandled GraphQL query: ${query}`);
}

module.exports = {
  isItemInProject,
  addItemToProject,
  setItemColumn,
  setItemSprint,
  setItemAssignees,
  getItemDetails,
  resetMocks,
  mockData,
  graphql,
  setMockFailure: (shouldFail) => { mockData.shouldFail = shouldFail; },
  getItemColumn
};
