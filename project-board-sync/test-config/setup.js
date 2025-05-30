// Configure testing environment
const TEST_ENV = {
  NODE_ENV: process.env.NODE_ENV || 'test',
  GH_TOKEN: process.env.GH_TOKEN || 'test-token',
  GITHUB_AUTHOR: process.env.GITHUB_AUTHOR || 'test-user'
};

// Mock octokit
jest.mock('../src/github/api', () => {
  const mockApi = require('./mocks/github-api');
  return {
    octokit: {
      graphql: mockApi.graphql,
      rest: {
        projects: {
          createCard: jest.fn(),
          moveCard: jest.fn()
        }
      }
    },
    graphqlWithAuth: mockApi.graphql,
    isItemInProject: mockApi.isItemInProject,
    addItemToProject: mockApi.addItemToProject,
    getRecentItems: mockApi.getRecentItems,
    setItemColumn: mockApi.setItemColumn,
    getItemColumn: mockApi.getItemColumn
  };
});

// Set up environment variables for tests
Object.entries(TEST_ENV).forEach(([key, value]) => {
  process.env[key] = value;
});

// Test configuration
const TEST_CONFIG = {
  projectId: process.env.PROJECT_ID || 'PVT_kwDOAA37OM4AFuzg',
  org: 'bcgov',
  repos: [
    'nr-nerds',
    'quickstart-openshift',
    'quickstart-openshift-backends',
    'quickstart-openshift-helpers'
  ],
  monitoredUser: process.env.GITHUB_AUTHOR || 'test-user',
  monitoredRepos: new Set([
    'bcgov/nr-nerds',
    'bcgov/quickstart-openshift',
    'bcgov/quickstart-openshift-backends',
    'bcgov/quickstart-openshift-helpers'
  ]),
  testData: {
    columns: {
      'New': 'optionId1',
      'Active': 'optionId2',
      'Done': 'optionId3'
    },
    sprints: {
      'Current Sprint': 'sprint-1',
      'Next Sprint': 'sprint-2'
    }
  }
};

// Ensure required environment variables are set
function checkEnv() {
  const required = ['GH_TOKEN'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }
}

// Clean up test data between runs
function cleanupTest() {
  // Could add cleanup logic here if needed
}

module.exports = {
  TEST_CONFIG,
  checkEnv,
  cleanupTest
};
