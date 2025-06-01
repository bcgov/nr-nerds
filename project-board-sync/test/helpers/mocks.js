// Common test mocks for GitHub API

/**
 * Mock GitHub API responses
 */
function mockGitHubApi(api) {
  // Mock GraphQL responses
  api.octokit = {
    graphql: async (query, variables) => {
      if (query.includes('field(name: $fieldName)')) {
        return {
          node: {
            field: {
              id: 'field-123'
            }
          }
        };
      }
      return {};
    }
  };

  // Mock column operations
  api.getFieldId = async () => 'field-123';
  api.setItemColumn = async () => ({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'updated' } } } });
  api.setItemAssignees = async () => ({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'updated' } } } });
  
  return api;
}

module.exports = {
  mockGitHubApi
};
