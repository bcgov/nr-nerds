const api = require('../../src/github/api');

/**
 * Set up mock GitHub API responses for testing
 */
function mockGitHubApi() {
  // Reset all mocks
  jest.resetAllMocks();
  
  // Mock common API calls
  api.getFieldId = jest.fn().mockResolvedValue('field-123');
  api.setItemColumn = jest.fn().mockResolvedValue(undefined);
  api.setItemAssignees = jest.fn().mockResolvedValue(undefined);
  api.getItemColumn = jest.fn().mockResolvedValue('Active');
  api.getItemAssignees = jest.fn().mockResolvedValue([]);
  api.octokit = { graphql: jest.fn().mockResolvedValue({}) };

  return api;
}

module.exports = {
  mockGitHubApi
};
