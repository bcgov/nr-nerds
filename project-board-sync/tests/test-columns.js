const { processColumnAssignment } = require('../src/rules/columns');
const { TEST_CONFIG } = require('../test-config/setup');
const { Logger } = require('../src/utils/log');

describe('Rule Set 2: Column Assignment', () => {
  describe('Pull Requests', () => {
    test('should assign new PR to Active column', async () => {
      const testPR = {
        id: 'test-pr-1',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-1',
        number: 101,
        repository: { nameWithOwner: 'bcgov/test-repo' }
      };

      // Mock empty current column (new PR)
      const api = require('../src/github/api');
      const originalGetItemColumn = api.getItemColumn;
      api.getItemColumn = jest.fn().mockResolvedValue(null);

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);

      // Restore original function
      api.getItemColumn = originalGetItemColumn;

      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe('Active');
      expect(result.reason).toBe('Set column to Active based on initial rules');
    });

    test('should not change column for closed PR (handled by GitHub)', async () => {
      const testPR = {
        id: 'test-pr-3',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-3',
        state: 'CLOSED',
        number: 103
      };

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

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column handled by GitHub automation for merged items');
    });

    test('should not change column if PR is already in Done (handled by GitHub)', async () => {
      const testPR = {
        id: 'test-pr-5',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-5',
        number: 105
      };

      // Mock that this PR is already in the Done column
      const api = require('../src/github/api');
      const originalGetItemColumn = api.getItemColumn;
      api.getItemColumn = jest.fn().mockResolvedValue('Done');

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      
      // Restore original function
      api.getItemColumn = originalGetItemColumn;
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
      const api = require('../src/github/api');
      const originalGetItemColumn = api.getItemColumn;
      api.getItemColumn = jest.fn().mockResolvedValue('Active');

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      
      // Restore original function
      api.getItemColumn = originalGetItemColumn;
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
        number: 201,
        repository: { nameWithOwner: 'bcgov/test-repo' }
      };

      // Mock empty current column (new issue)
      const api = require('../src/github/api');
      const originalGetItemColumn = api.getItemColumn;
      api.getItemColumn = jest.fn().mockResolvedValue(null);

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);

      // Restore original function
      api.getItemColumn = originalGetItemColumn;

      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe('New');
      expect(result.reason).toBe('Set column to New based on initial rules');
    });

    test('should not change column for closed issue (handled by GitHub)', async () => {
      const testIssue = {
        id: 'test-issue-3',
        __typename: 'Issue',
        projectItemId: 'test-project-item-5',
        state: 'CLOSED',
        number: 203
      };

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
      const api = require('../src/github/api');
      const originalGetItemColumn = api.getItemColumn;
      api.getItemColumn = jest.fn().mockResolvedValue('Done');

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
      
      // Restore original function
      api.getItemColumn = originalGetItemColumn;
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column "Done" is handled by GitHub automation');
      expect(result.currentStatus).toBe('Done');
    });

    test('should not change column if issue already has correct column', async () => {
      const testIssue = {
        id: 'test-issue-5',
        __typename: 'Issue',
        projectItemId: 'test-project-item-8',
        number: 205
      };

      // Mock that this issue is already in the New column
      const api = require('../src/github/api');
      const originalGetItemColumn = api.getItemColumn;
      api.getItemColumn = jest.fn().mockResolvedValue('New');

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
      
      // Restore original function
      api.getItemColumn = originalGetItemColumn;
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Column already set to New');
      expect(result.currentStatus).toBe('New');
    });
  });
});
