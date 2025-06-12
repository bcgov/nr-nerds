// Ensure test runner is available
const test = require('node:test');
if (!test) {
    throw new Error('node:test module not available');
}
const { describe, it } = test;
const assert = require('node:assert/strict');
console.log('Test module loaded:', { describe: !!describe, it: !!it });

describe('PR authored by monitored user rule', async () => {
    let processBoardItemRules;
    const logMessages = [];
    
    it('setup', async () => {
        // Mock our dependencies
        process.env.GITHUB_AUTHOR = 'DerekRoberts';
        
        // Set up fake module cache for mocks
        const validatorPath = require.resolve('../shared-validator');
        const rulesPath = require.resolve('../../../config/board-rules');
        const logPath = require.resolve('../../../utils/log');
        
        require.cache[validatorPath] = {
            exports: {
                validator: {
                    validateItemCondition: (item, trigger) => {
                        if (trigger.condition === 'item.author === monitored.user') {
                            return item.author?.login === process.env.GITHUB_AUTHOR;
                        }
                        return false;
                    }
                }
            }
        };
        
        require.cache[rulesPath] = {
            exports: {
                loadBoardRules: async () => ({
                    rules: {
                        board_items: [{
                            name: "PullRequest by Author",
                            description: "Add pull requests authored by monitored user",
                            trigger: {
                                type: "PullRequest",
                                condition: "item.author === monitored.user"
                            },
                            action: "add_to_board",
                            skip_if: "item.inProject"
                        }]
                    }
                })
            }
        };
        
        require.cache[logPath] = {
            exports: {
                log: {
                    info: (msg) => logMessages.push(msg),
                    debug: (msg) => logMessages.push(msg)
                }
            }
        };

        // Import module under test
        try {
            console.log('Loading board-items module...');
            const boardItemsPath = require.resolve('../board-items');
            console.log('Board items path:', boardItemsPath);
            const boardItems = require('../board-items');
            console.log('Board items loaded:', Object.keys(boardItems));
            processBoardItemRules = boardItems.processBoardItemRules;
            console.log('Process board items function:', typeof processBoardItemRules);
        } catch (err) {
            console.error('Failed to load board-items:', err);
            throw err;
        }
    });

    it('adds PR to board when authored by monitored user', async () => {
        logMessages.length = 0;
        
        const testPR = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'DerekRoberts' },
            repository: { nameWithOwner: 'test-org/nr-nerds' },
            projectItems: { nodes: [] }
        };
        
        const actions = await processBoardItemRules(testPR);
        
        assert.equal(actions.length, 1, 'should add PR to board');
        assert.equal(actions[0].action, 'add_to_board', 'action should be add_to_board');
        assert.deepEqual(actions[0].params, { item: testPR }, 'should include PR in params');
        assert.ok(logMessages.some(msg => msg.includes('Adding PullRequest #123 to board')), 
            'should log board addition');
    });

    it('skips PR when already in project', async () => {
        logMessages.length = 0;
        
        const testPR = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'DerekRoberts' },
            repository: { nameWithOwner: 'test-org/nr-nerds' },
            projectItems: { nodes: [{ id: 'exists' }] }
        };
        
        const actions = await processBoardItemRules(testPR);
        
        assert.equal(actions.length, 0, 'should skip PR already in project');
        assert.ok(logMessages.some(msg => msg.includes('Skipping PullRequest #123')),
            'should log skip reason');
    });

    it('skips PR when author is not monitored user', async () => {
        logMessages.length = 0;
        
        const testPR = {
            __typename: 'PullRequest',
            number: 123,
            author: { login: 'otherUser' },
            repository: { nameWithOwner: 'test-org/nr-nerds' },
            projectItems: { nodes: [] }
        };
        
        const actions = await processBoardItemRules(testPR);
        
        assert.equal(actions.length, 0, 'should skip PR from non-monitored author');
    });
});
