// Mock API helpers for testing
const createApiMocks = () => {
  // Track state for assertions
  const state = {
    columnUpdates: [],
    assigneeUpdates: [],
    fieldIdRequests: [],
    graphqlQueries: [],
    errors: null
  };

  const mockGraphQLResponse = (query, variables) => {
    // Project field query for field ID
    if (query.includes('field(name: $fieldName)')) {
      return {
        node: {
          field: {
            id: 'status-field-123'
          }
        }
      };
    }
    
    // Project field query for options
    if (query.includes('... on ProjectV2SingleSelectField')) {
      return {
        node: {
          field: {
            options: [
              { id: 'option-todo', name: 'To Do' },
              { id: 'option-progress', name: 'In Progress' },
              { id: 'option-done', name: 'Done' }
            ]
          }
        }
      };
    }

    return {};
  };

  const mocks = {
    // Mock GraphQL queries
    graphql: async (query, variables) => {
      state.graphqlQueries.push({ query, variables });
      if (state.errors?.graphql) throw state.errors.graphql;
      return mockGraphQLResponse(query, variables);
    },

    // Mock GraphQL with auth
    graphqlWithAuth: async (query, variables) => {
      return mocks.graphql(query, variables);
    },

    // Mock Octokit instance
    octokit: {
      graphql: async (query, variables) => mocks.graphql(query, variables)
    },

    // Mock field ID resolution
    getFieldId: async (projectId, fieldName) => {
      state.fieldIdRequests.push({ projectId, fieldName });
      if (state.errors?.fieldId) throw state.errors.fieldId;
      return 'field-123';
    },

    // Mock column updates
    setItemColumn: async (projectId, itemId, column) => {
      state.columnUpdates.push({ projectId, itemId, column });
      if (state.errors?.column) throw state.errors.column;
    },

    // Mock assignee updates
    setItemAssignees: async (projectId, itemId, assignees) => {
      state.assigneeUpdates.push({ projectId, itemId, assignees });
      if (state.errors?.assignees) throw state.errors.assignees;
    },

    // Helper to simulate errors
    setError: (type, error) => {
      state.errors = state.errors || {};
      state.errors[type] = error;
    },

    // Helper to reset state
    reset: () => {
      state.columnUpdates = [];
      state.assigneeUpdates = [];
      state.fieldIdRequests = [];
      state.graphqlQueries = [];
      state.errors = null;
    },

    // Helper to get current state
    getState: () => ({ ...state })
  };

  return mocks;
};

module.exports = { createApiMocks };
