const { shouldAddItemToProject } = require('../src/rules/add-items');
const { TEST_CONFIG } = require('../test-config/setup');
const { Logger } = require('../src/utils/log');
const log = new Logger();

// Mock the GitHub API
jest.mock('../src/github/api', () => require('../test-config/mocks/github-api'));
const { processItemForProject } = require('../src/rules/add-items');
const { resetMocks, addMockItem, setMockFailure } = require('../test-config/mocks/github-api');

describe('Rule Set 1: Adding Items to Project Board', () => {
  const testContext = {
    monitoredUser: TEST_CONFIG.monitoredUser,
    monitoredRepos: TEST_CONFIG.monitoredRepos,
    processedIds: new Set()
  };

  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
    testContext.processedIds.clear();
  });

  describe('Processing Pull Requests', () => {
    test('should add PR authored by monitored user', async () => {
      const testPR = {
        id: 'test-pr-1',
        __typename: 'PullRequest',
        number: 101,
        repository: { nameWithOwner: 'bcgov/nr-nerds' },
        author: { login: TEST_CONFIG.monitoredUser },
        assignees: { nodes: [] }
      };

      const result = await processItemForProject(testPR, TEST_CONFIG.projectId, testContext);
      
      expect(result.added).toBe(true);
      expect(result.projectItemId).toBeTruthy();
      expect(result.reason).toContain('Added as PullRequest');
    });

    test('should add PR assigned to monitored user', async () => {
      const testPR = {
        id: 'test-pr-2',
        __typename: 'PullRequest',
        number: 102,
        repository: { nameWithOwner: 'external/repo' },
        author: { login: 'someone-else' },
        assignees: { nodes: [{ login: TEST_CONFIG.monitoredUser }] }
      };

      const result = await processItemForProject(testPR, TEST_CONFIG.projectId, testContext);
      
      expect(result.added).toBe(true);
      expect(result.projectItemId).toBeTruthy();
      expect(result.reason).toContain('Added as PullRequest');
    });

    test('should skip PR not matching any criteria', async () => {
      const testPR = {
        id: 'test-pr-3',
        __typename: 'PullRequest',
        number: 103,
        repository: { nameWithOwner: 'external/repo' },
        author: { login: 'someone-else' },
        assignees: { nodes: [{ login: 'someone-else' }] }
      };

      const result = await processItemForProject(testPR, TEST_CONFIG.projectId, testContext);
      
      expect(result.added).toBe(false);
      expect(result.projectItemId).toBeFalsy();
      expect(result.reason).toBe('Does not match add criteria');
    });
  });

  describe('Processing Issues', () => {
    test('should add issue from monitored repository', async () => {
      const testIssue = {
        id: 'test-issue-1',
        __typename: 'Issue',
        number: 201,
        repository: { nameWithOwner: 'bcgov/nr-nerds' },
        author: { login: 'someone-else' },
        assignees: { nodes: [] }
      };

      const result = await processItemForProject(testIssue, TEST_CONFIG.projectId, testContext);
      
      expect(result.added).toBe(true);
      expect(result.projectItemId).toBeTruthy();
      expect(result.reason).toContain('Added as Issue');
    });

    test('should skip issue not from monitored repository', async () => {
      const testIssue = {
        id: 'test-issue-2',
        __typename: 'Issue',
        number: 202,
        repository: { nameWithOwner: 'external/repo' },
        author: { login: 'someone-else' },
        assignees: { nodes: [] }
      };

      const result = await processItemForProject(testIssue, TEST_CONFIG.projectId, testContext);
      
      expect(result.added).toBe(false);
      expect(result.projectItemId).toBeFalsy();
      expect(result.reason).toBe('Does not match add criteria');
    });
  });

  describe('Error Handling', () => {
    test('should handle API errors gracefully', async () => {
      const testPR = {
        id: 'test-pr-4',
        __typename: 'PullRequest',
        number: 104,
        repository: { nameWithOwner: 'bcgov/nr-nerds' },
        author: { login: TEST_CONFIG.monitoredUser },
        assignees: { nodes: [] }
      };

      setMockFailure(true);
      
      await expect(processItemForProject(testPR, TEST_CONFIG.projectId, testContext))
        .rejects.toThrow('Mock API Error');
    });

    test('should not process same item twice', async () => {
      const testPR = {
        id: 'test-pr-5',
        __typename: 'PullRequest',
        number: 105,
        repository: { nameWithOwner: 'bcgov/nr-nerds' },
        author: { login: TEST_CONFIG.monitoredUser },
        assignees: { nodes: [] }
      };

      // First attempt should add the item
      const result1 = await processItemForProject(testPR, TEST_CONFIG.projectId, testContext);
      expect(result1.added).toBe(true);

      // Second attempt should skip
      const result2 = await processItemForProject(testPR, TEST_CONFIG.projectId, testContext);
      expect(result2.added).toBe(false);
      expect(result2.reason).toBe('Already processed');
    });
  });
});
