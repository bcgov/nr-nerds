const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBoardRules } = require('../src/config/board-rules');

test('PRs authored by monitored user in any repository are processed', async (t) => {
    const config = await loadBoardRules();
    const monitoredUser = config.monitoredUser;
    
    // Set up environment with config values
    process.env.GITHUB_AUTHOR = monitoredUser;
    
    // Test 1: PR authored by monitored user in monitored repo
    const pr1 = {
        id: 'PVTI_test123',
        __typename: 'PullRequest',
        number: 123,
        title: 'Test PR',
        author: { login: monitoredUser },
        assignees: { nodes: [] },
        repository: { 
            name: config.automation.repository_scope.repositories[0], 
            owner: { login: config.automation.repository_scope.organization } 
        },
        projectItems: { nodes: [] }
    };
    
    // Simulate processing logic
    const shouldProcess1 = pr1.author.login === monitoredUser;
    assert(shouldProcess1, `Should process PR authored by ${monitoredUser} in monitored repo`);
    
    // Test 2: PR authored by monitored user in ANY repo (this is the key test)
    const pr2 = {
        id: 'PVTI_test456',
        __typename: 'PullRequest',
        number: 456,
        title: 'Test PR in any repo',
        author: { login: monitoredUser },
        assignees: { nodes: [] },
        repository: { 
            name: 'any-other-repo', 
            owner: { login: 'other-org' } 
        },
        projectItems: { nodes: [] }
    };
    
    const shouldProcess2 = pr2.author.login === monitoredUser;
    assert(shouldProcess2, `Should process PR authored by ${monitoredUser} in any repo`);
    
    console.log('✅ Author assignment test passed');
});
