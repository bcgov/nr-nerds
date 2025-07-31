const test = require('node:test');
const assert = require('node:assert/strict');
const { processBoardItemRules } = require('../src/rules/processors/board-items');

// Set up test environment for DerekRoberts
process.env.GITHUB_AUTHOR = 'DerekRoberts';

test('PRs authored by DerekRoberts in any repository are processed', async (t) => {
    // Test 1: PR authored by DerekRoberts in monitored repo
    const prInMonitoredRepo = {
        __typename: 'PullRequest',
        number: 123,
        repository: { nameWithOwner: 'bcgov/nr-nerds' },
        author: { login: 'DerekRoberts' },
        assignees: { nodes: [] }
    };
    
    const actions1 = await processBoardItemRules(prInMonitoredRepo);
    console.log(`✅ Found ${actions1.length} actions for PR in monitored repo`);
    assert(actions1.length > 0, 'Should find actions for PR in monitored repo');
    
    // Test 2: PR authored by DerekRoberts in ANY repo (this is the key test)
    const prInAnyRepo = {
        __typename: 'PullRequest',
        number: 124,
        repository: { nameWithOwner: 'some-other-org/some-other-repo' },
        author: { login: 'DerekRoberts' },
        assignees: { nodes: [] }
    };
    
    const actions2 = await processBoardItemRules(prInAnyRepo);
    console.log(`✅ Found ${actions2.length} actions for PR in any repo`);
    
    // This should work because the "PullRequest by Author" rule doesn't check repository
    assert(actions2.length > 0, 'Should find actions for PR authored by DerekRoberts in any repo');
    
    console.log('✅ Author assignment test passed');
}); 
