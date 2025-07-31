const test = require('node:test');
const assert = require('node:assert/strict');
const { RuleValidation } = require('../src/rules/processors/validation');

// Set up test environment
process.env.GITHUB_AUTHOR = 'test-user';

test('Basic condition validation works', async (t) => {
    const validator = new RuleValidation();
    
    // Test 1: Author condition
    const prWithAuthor = {
        __typename: 'PullRequest',
        number: 123,
        author: { login: 'test-user' }
    };
    
    const result1 = validator.validateItemCondition(prWithAuthor, {
        type: 'PullRequest',
        condition: 'item.author === monitored.user'
    });
    assert.equal(result1, true, 'Author condition should pass');
    
    // Test 2: Repository condition
    const prInRepo = {
        __typename: 'PullRequest',
        number: 124,
        repository: { nameWithOwner: 'bcgov/nr-nerds' }
    };
    
    const result2 = validator.validateItemCondition(prInRepo, {
        type: 'PullRequest',
        condition: 'monitored.repos.includes(item.repository)'
    });
    assert.equal(result2, true, 'Repository condition should pass');
    
    // Test 3: Column condition
    const prNoColumn = {
        __typename: 'PullRequest',
        number: 125,
        column: null
    };
    
    const result3 = validator.validateItemCondition(prNoColumn, {
        type: 'PullRequest',
        condition: '!item.column'
    });
    assert.equal(result3, true, 'No column condition should pass');
    
    console.log('✅ All basic validation tests passed');
}); 
