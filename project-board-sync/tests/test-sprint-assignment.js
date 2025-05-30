const { processSprintAssignment } = require('../src/rules/sprints');
const { TEST_CONFIG } = require('../test-config/setup');
const { Logger } = require('../src/utils/log');
const log = new Logger();

describe('Rule Set 3: Sprint Assignment', () => {
  const projectId = TEST_CONFIG.projectId;

  describe('Active Items', () => {
    test('should not assign sprint to items not in Next/Active/Done columns', async () => {
      const activeItem = {
        id: 'test-item-1',
        __typename: 'PullRequest',
        number: 101,
        repository: { nameWithOwner: 'bcgov/nr-nerds' }
      };

      const result = await processSprintAssignment(activeItem, 'test-project-item-1', projectId, 'Some Other Column');
      expect(result.changed).toBe(false);
      expect(result.reason).toBe('Not in Next, Active, or Done column');
    });

    test('should assign current sprint to items in Active column', async () => {
      const activeItem = {
        id: 'test-item-2',
        __typename: 'PullRequest',
        number: 102,
        repository: { nameWithOwner: 'bcgov/nr-nerds' }
      };

      const result = await processSprintAssignment(activeItem, 'test-project-item-2', projectId, 'Active');
      expect(result.changed).toBe(true);
      expect(result.newSprint).toBe(TEST_CONFIG.testData.sprints['Current Sprint']);
    });
  });

  describe('Done Items', () => {
    test('should assign current sprint to items in Done column', async () => {
      const doneItem = {
        id: 'test-item-3',
        __typename: 'PullRequest',
        number: 103,
        repository: { nameWithOwner: 'bcgov/nr-nerds' }
      };

      const result = await processSprintAssignment(doneItem, 'test-project-item-3', projectId, 'Done');
      expect(result.changed).toBe(true);
      expect(result.newSprint).toBe(TEST_CONFIG.testData.sprints['Current Sprint']);
    });
  });
});
