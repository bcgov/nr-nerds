const { test } = require('node:test');
const assert = require('node:assert/strict');
const { StateVerifier } = require('../state-verifier');
const { getItemAssignees, getItemDetails } = require('../../rules/assignees');
const { octokit } = require('../../github/api');

// Mock the dependencies
jest.mock('../../rules/assignees');
jest.mock('../../github/api');

test('verifyAssignees', async (t) => {
  await t.test('succeeds when assignees match in both project board and Issue/PR', async () => {
    // Mock data
    const testItem = {
      type: 'PullRequest',
      number: 123,
      id: 'PR_123',
      projectItemId: 'project_item_123'
    };

    // Setup mocks
    getItemAssignees.mockResolvedValue(['user1', 'user2']);
    getItemDetails.mockResolvedValue({
      content: {
        repository: { nameWithOwner: 'owner/repo' },
        number: 123
      }
    });
    octokit.rest.pulls.get.mockResolvedValue({
      data: {
        assignees: [{ login: 'user1' }, { login: 'user2' }]
      }
    });

    // Test
    await StateVerifier.verifyAssignees(testItem, 'project_123', ['user1', 'user2']);
  });

  await t.test('detects missing assignees in project board', async () => {
    // Mock data
    const testItem = {
      type: 'PullRequest',
      number: 123,
      id: 'PR_123',
      projectItemId: 'project_item_123'
    };

    // Setup mocks
    getItemAssignees.mockResolvedValue(['user1']);  // Missing user2
    getItemDetails.mockResolvedValue({
      content: {
        repository: { nameWithOwner: 'owner/repo' },
        number: 123
      }
    });
    octokit.rest.pulls.get.mockResolvedValue({
      data: {
        assignees: [{ login: 'user1' }, { login: 'user2' }]
      }
    });

    // Test
    await assert.rejects(
      () => StateVerifier.verifyAssignees(testItem, 'project_123', ['user1', 'user2']),
      /Missing in project board: user2/
    );
  });

  await t.test('detects missing assignees in Issue/PR', async () => {
    // Mock data
    const testItem = {
      type: 'PullRequest',
      number: 123,
      id: 'PR_123',
      projectItemId: 'project_item_123'
    };

    // Setup mocks
    getItemAssignees.mockResolvedValue(['user1', 'user2']);
    getItemDetails.mockResolvedValue({
      content: {
        repository: { nameWithOwner: 'owner/repo' },
        number: 123
      }
    });
    octokit.rest.pulls.get.mockResolvedValue({
      data: {
        assignees: [{ login: 'user1' }]  // Missing user2
      }
    });

    // Test
    await assert.rejects(
      () => StateVerifier.verifyAssignees(testItem, 'project_123', ['user1', 'user2']),
      /Missing in Issue\/PR: user2/
    );
  });

  await t.test('detects extra assignees in both places', async () => {
    // Mock data
    const testItem = {
      type: 'PullRequest',
      number: 123,
      id: 'PR_123',
      projectItemId: 'project_item_123'
    };

    // Setup mocks
    getItemAssignees.mockResolvedValue(['user1', 'user2', 'user3']); // Extra user3
    getItemDetails.mockResolvedValue({
      content: {
        repository: { nameWithOwner: 'owner/repo' },
        number: 123
      }
    });
    octokit.rest.pulls.get.mockResolvedValue({
      data: {
        assignees: [{ login: 'user1' }, { login: 'user2' }, { login: 'user4' }] // Extra user4
      }
    });

    // Test
    await assert.rejects(
      () => StateVerifier.verifyAssignees(testItem, 'project_123', ['user1', 'user2']),
      (err) => {
        assert(err.message.includes('Extra in project board: user3'));
        assert(err.message.includes('Extra in Issue/PR: user4'));
        return true;
      }
    );
  });
});
