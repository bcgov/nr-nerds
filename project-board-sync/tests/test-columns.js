const { processColumnAssignment } = require('../src/rules/columns');
const { TEST_CONFIG } = require('../test-config/setup');
const api = require('../src/github/api');

describe('Rule Set 2: Column Assignment', () => {
  let getItemColumnMock;

  beforeEach(() => {
    // Set up the mock before each test
    getItemColumnMock = jest.spyOn(api, 'getItemColumn');
  });

  afterEach(() => {
    // Clean up after each test
    getItemColumnMock.mockRestore();
  });

  describe('Pull Requests', () => {
    test('should assign new PR to Active column', async () => {
      const testPR = {
        id: 'test-pr-1',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-1',
        number: 101
      };

      // Mock that this is a new PR (no current column)
      getItemColumnMock.mockResolvedValue(null);

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe('Active');
      expect(result.reason).toBe('initial column assignment');
    });

    test('should not change column for closed PR (handled by GitHub)', async () => {
      const testPR = {
        id: 'test-pr-3',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-3',
        state: 'CLOSED',
        number: 103
      };

      getItemColumnMock.mockResolvedValue('Active');

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column handled by GitHub automation for closed items');
    });

    test('should not change column for merged PR (handled by GitHub)', async () => {
      const testPR = {
        id: 'test-pr-4',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-4',
        state: 'MERGED',
        number: 104
      };

      getItemColumnMock.mockResolvedValue('Active');

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column handled by GitHub automation for merged items');
    });

    test('should move PR from New to Active column', async () => {
      const testPR = {
        id: 'test-pr-new-to-active',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-new',
        number: 107,
        state: 'OPEN'
      };

      // Mock that this PR is in New column
      getItemColumnMock.mockResolvedValue('New');

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe('Active');
      expect(result.reason).toBe('PR moved from New to Active');
    });

    test('should not change column if PR is already in Done (handled by GitHub)', async () => {
      const testPR = {
        id: 'test-pr-5',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-5',
        number: 105
      };

      // Mock that this PR is already in the Done column
      getItemColumnMock.mockResolvedValue('Done');

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column "Done" is handled by GitHub automation');
      expect(result.currentStatus).toBe('Done');
    });

    test('should not change column if PR already has correct column', async () => {
      const testPR = {
        id: 'test-pr-6',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-6',
        number: 106
      };

      // Mock that this PR is already in the Active column
      getItemColumnMock.mockResolvedValue('Active');

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column already set to Active');
      expect(result.currentStatus).toBe('Active');
    });
  });

  describe('Issues', () => {
    test('should assign new issue to New column', async () => {
      const testIssue = {
        id: 'test-issue-1',
        __typename: 'Issue',
        projectItemId: 'test-project-item-2',
        number: 201
      };

      // Mock that this is a new issue (no current column)
      getItemColumnMock.mockResolvedValue(null);

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe('New');
      expect(result.reason).toBe('initial column assignment');
    });

    test('should not change column for closed issue (handled by GitHub)', async () => {
      const testIssue = {
        id: 'test-issue-3',
        __typename: 'Issue',
        projectItemId: 'test-project-item-5',
        state: 'CLOSED',
        number: 203
      };

      getItemColumnMock.mockResolvedValue('New');

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column handled by GitHub automation for closed items');
    });

    test('should not change column if issue is already in Done (handled by GitHub)', async () => {
      const testIssue = {
        id: 'test-issue-4',
        __typename: 'Issue',
        projectItemId: 'test-project-item-7',
        number: 204
      };

      // Mock that this issue is already in the Done column
      getItemColumnMock.mockResolvedValue('Done');

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column "Done" is handled by GitHub automation');
      expect(result.currentStatus).toBe('Done');
    });

    test('should not change column if issue already has any column except New', async () => {
      const testIssue = {
        id: 'test-issue-skip',
        __typename: 'Issue',
        projectItemId: 'test-project-item-skip',
        number: 206,
        state: 'OPEN'
      };

      // Mock that this issue is already in Active column
      getItemColumnMock.mockResolvedValue('Active');

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('No column change needed');
      expect(result.currentStatus).toBe('Active');
    });

    test('should not change column if issue already has correct column', async () => {
      const testIssue = {
        id: 'test-issue-5',
        __typename: 'Issue',
        projectItemId: 'test-project-item-8',
        number: 205
      };

      // Mock that this issue is already in the New column
      getItemColumnMock.mockResolvedValue('New');

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column already set to New');
      expect(result.currentStatus).toBe('New');
    });
  });
});
