const { log } = require('../src/utils/log');
const { processAddItems } = require('../src/rules/add-items');

// Mock test data
const testItems = [
  {
    __typename: 'PullRequest',
    number: 123,
    id: 'PR_123',
    repository: { nameWithOwner: 'bcgov/nr-nerds' },
    author: { login: 'DerekRoberts' },
    assignees: { nodes: [{ login: 'alice' }] }
  },
  {
    __typename: 'Issue',
    number: 456,
    id: 'ISSUE_456',
    repository: { nameWithOwner: 'external/repo' },
    author: { login: 'someone-else' },
    assignees: { nodes: [] }
  }
];

// Mock API functions
jest.mock('../src/github/api', () => ({
  getRecentItems: async () => testItems,
  isItemInProject: async () => ({ isInProject: false }),
  addItemToProject: async () => 'new-item-id'
}));

// Run the test
async function demoLogging() {
  await processAddItems({
    org: 'bcgov',
    repos: ['nr-nerds'],
    monitoredUser: 'DerekRoberts',
    projectId: 'test-project'
  });
}

demoLogging().catch(console.error);
