const test = require('node:test');
const assert = require('node:assert/strict');
const { processBoardItemRules } = require('../src/rules/processors/unified-rule-processor');

// Set up test environment
process.env.GITHUB_AUTHOR = 'test-user';

test('Rule processing works with basic conditions', async (t) => {
    // Test item that should match repository condition
    const testItem = {
        __typename: 'PullRequest',
        number: 123,
        repository: { nameWithOwner: 'bcgov/nr-nerds' },
        author: { login: 'other-user' },
        assignees: { nodes: [] }
    };
    
    try {
        const actions = await processBoardItemRules(testItem);
        console.log('✅ Rule processing test completed');
        console.log(`Found ${actions.length} actions for test item`);
        
        // Should find at least one action (repository condition)
        assert(actions.length > 0, 'Should find at least one matching rule');
        
        console.log('✅ Rule processing test passed');
    } catch (error) {
        console.error('❌ Rule processing test failed:', error.message);
        throw error;
    }
}); 
