const { test } = require('node:test');
const assert = require('node:assert');
const { Logger } = require('../../src/utils/log');
const { processAddItems } = require('../../src/rules/add-items');
const { processColumnAssignment } = require('../../src/rules/columns');
const { processSprintAssignment } = require('../../src/rules/sprints');
const { processAssignees } = require('../../src/rules/assignees');

// Set up API mocks
const { mockGitHubApi } = require('../helpers/mocks');
const api = mockGitHubApi({
  columns: { current: 'New' }  // Start PR in New column
});

// Mock getRecentItems to return a test PR
api.getRecentItems = async () => ([{
  __typename: 'PullRequest',
  id: 'pr-1',
  number: 123,
  repository: { nameWithOwner: 'bcgov/test-repo' },
  state: 'OPEN',
  merged: false,
  author: { login: 'test-user' },
  assignees: { nodes: [] },
  linkedIssues: { nodes: [] }
}]);

api.isItemInProject = async () => ({ isInProject: false });
api.addItemToProject = async () => 'project-item-1';
api.getFieldId = async () => 'field-123';
api.setItemColumn = async () => ({});
api.setItemAssignees = async () => ({});
api.octokit = { graphql: async () => ({}) };

test('full workflow tracks state changes correctly', async (t) => {
  // Create a test logger
  const log = new Logger();
  process.env.VERBOSE = 'true';

  // Set up test context
  const context = {
    org: 'bcgov',
    repos: ['test-repo'],
    monitoredUser: 'test-user',
    projectId: 'project-1'
  };

  // 1. Add items to project
  const { addedItems } = await processAddItems(context);
  assert.strictEqual(addedItems.length, 1, 'should add one item');
  const item = addedItems[0];
  assert.strictEqual(item.type, 'PullRequest', 'should be a PR');
  assert.strictEqual(item.projectItemId, 'project-item-1', 'should have project item ID');

  // 2. Set column
  const columnResult = await processColumnAssignment(item, item.projectItemId, context.projectId);
  assert.strictEqual(columnResult.changed, true, 'should change column');
  assert.strictEqual(columnResult.newStatus, 'In Progress', 'should set to In Progress');

  // 3. Set sprint
  const sprintResult = await processSprintAssignment(
    item,
    item.projectItemId,
    context.projectId,
    columnResult.newStatus
  );
  assert.strictEqual(sprintResult.changed, true, 'should change sprint');
  assert.ok(sprintResult.newSprint, 'should set sprint value');

  // 4. Set assignees
  const assigneeResult = await processAssignees(item, context.projectId, item.projectItemId);
  assert.strictEqual(assigneeResult.changed, true, 'should change assignees');
  assert.ok(Array.isArray(assigneeResult.assignees), 'should return assignees array');

  // Verify state tracking
  const states = log.logs.states;
  assert.ok(states.length > 0, 'should have tracked states');
  
  // Verify state changes show up in summary
  let summary = '';
  log.printStateSummary = () => {
    // Capture but don't actually print
    summary = JSON.stringify(log.logs.states);
  };
  log.printStateSummary();
  
  assert.ok(summary.includes('In Progress'), 'summary should show column change');
  assert.ok(summary.includes('project-item-1'), 'summary should show project item');
});
