const api = require('../../src/github/api');

/**
 * Centralized mock state and helper functions for GitHub API testing
 */
class GitHubApiMock {
  constructor(options = {}) {
    // Reset state
    this.reset();
    
    // Set up default states
    this.defaultStates = {
      columns: {
        field: 'field-123',
        current: 'Active',
        options: [
          { id: 'option-new', name: 'New' },
          { id: 'option-active', name: 'Active' },
          { id: 'option-done', name: 'Done' }
        ]
      },
      sprints: {
        field: 'sprint-field-456',
        current: 'Sprint 1',
        options: [
          { id: 'sprint-1', name: 'Sprint 1' },
          { id: 'sprint-2', name: 'Sprint 2' }
        ]
      },
      assignees: []
    };

    // Merge options with defaults
    this.states = {
      columns: { ...this.defaultStates.columns, ...options.columns },
      sprints: { ...this.defaultStates.sprints, ...options.sprints },
      assignees: options.assignees || []
    };

    this.setupMocks();
  }

  reset() {
    // Reset tracking state
    this.state = {
      columnUpdates: [],
      assigneeUpdates: [],
      fieldIdRequests: [],
      graphqlQueries: [],
      errors: null
    };
    jest.resetAllMocks();
  }

  setError(type, error) {
    this.state.errors = this.state.errors || {};
    this.state.errors[type] = error;
  }

  setupMocks() {
    // Mock field ID resolution
    api.getFieldId = jest.fn().mockImplementation(async (projectId, fieldName) => {
      this.state.fieldIdRequests.push({ projectId, fieldName });
      if (this.state.errors?.fieldId) throw this.state.errors.fieldId;
      
      if (fieldName.toLowerCase() === 'status') return this.states.columns.field;
      if (fieldName.toLowerCase() === 'sprint') return this.states.sprints.field;
      return null;
    });

    // Mock item updates
    api.setItemColumn = jest.fn().mockImplementation(async (projectId, itemId, column) => {
      this.state.columnUpdates.push({ projectId, itemId, column });
      if (this.state.errors?.column) throw this.state.errors.column;
    });

    api.setItemAssignees = jest.fn().mockImplementation(async (projectId, itemId, assignees) => {
      this.state.assigneeUpdates.push({ projectId, itemId, assignees });
      if (this.state.errors?.assignees) throw this.state.errors.assignees;
    });

    // Mock current state getters
    api.getItemColumn = jest.fn().mockResolvedValue(this.states.columns.current);
    api.getItemAssignees = jest.fn().mockResolvedValue(this.states.assignees);

    // GraphQL mock with schema-aware responses and query tracking
    api.octokit = {
      graphql: jest.fn().mockImplementation(async (query, variables) => {
        this.state.graphqlQueries.push({ query, variables });
        if (this.state.errors?.graphql) throw this.state.errors.graphql;

        if (query.includes('... on ProjectV2SingleSelectField')) {
          if (query.includes('field(name: "Status")')) {
            return {
              node: {
                field: {
                  options: this.states.columns.options
                }
              }
            };
          }
          if (query.includes('field(name: "Sprint")')) {
            return {
              node: {
                field: {
                  options: this.states.sprints.options
                }
              }
            };
          }
        }
        return {};
      })
    };
  }
}

/**
 * Set up mock GitHub API responses for testing
 * @param {Object} options Configuration for mock responses
 * @returns {Object} Mocked API instance with tracking capabilities
 */
function mockGitHubApi(options = {}) {
  const mock = new GitHubApiMock(options);
  return api;
}

module.exports = {
  mockGitHubApi
};
