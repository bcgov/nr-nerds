const { processColumnAssignment } = require('../src/rules/columns');
const { TEST_CONFIG } = require('../test-config/setup');
const { Logger } = require('../src/utils/log');

describe('Rule Set 2: Column Assignment', () => {
  describe('Pull Requests', () => {
    test('should assign new PR to New column', async () => {
      const testPR = {
        id: 'test-pr-1',
        __typename: 'PullRequest',
        projectItemId: 'test-project-item-1',
      };

      const result = await processColumnAssignment(testPR, testPR.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe('New');
    });
  });

  describe('Issues', () => {
    test('should assign new issue to New column', async () => {
      const testIssue = {
        id: 'test-issue-1',
        __typename: 'Issue',
        projectItemId: 'test-project-item-2',
      };

      const result = await processColumnAssignment(testIssue, testIssue.projectItemId, TEST_CONFIG.projectId);
      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe('New');
    });
  });
});
