const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test/mock');

test('PR assigned to monitored user rule', async (t) => {
    // Shared variables for all sub-tests
    let processBoardItemRules;
    const logMessages = [];
    
    // Setup test environment and mocks before each test
    t.beforeEach(() => {
        // Mock dependencies
        mock.method(require('../shared-validator').validator, 'validateItemCondition', 
            (item, trigger) => {
                if (trigger.condition === 'item.assignees includes monitored.user') {
                    return item.assignees?.nodes?.some(a => a.login === process.env.GITHUB_ASSIGNEE);
                }
                return false;
            }
        );
        
        mock.method(require('../../../config/board-rules'), 'loadBoardRules', 
            async () => ({
                rules: {
                    board_items: [{
                        name: "PullRequest by Assignee",
                        description: "Add pull requests assigned to monitored user",
                        trigger: {
                            type: "PullRequest",
                            condition: "item.assignees includes monitored.user"
                        },
                        action: "add_to_board",
                        skip_if: "item.inProject"
                    }]
                }
            })
        );

        mock.method(require('../../../utils/log').log, 'info', (msg) => logMessages.push(msg));
        mock.method(require('../../../utils/log').log, 'debug', (msg) => logMessages.push(msg));
        mock.method(require('../../../utils/log').log, 'error', (msg) => logMessages.push(msg));

        // Set test environment
        process.env.GITHUB_ASSIGNEE = 'testAssignee';
        
        // Clear log messages
        logMessages.length = 0;
        
        // Import after mocks are set up
        const boardItems = require('../board-items');
        processBoardItemRules = boardItems.processBoardItemRules;
    });

    t.afterEach(() => {
        // Clear mocks
        mock.reset();
    });

    await t.test('adds PR to board when assigned to monitored user', async () => {
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            assignees: { 
                nodes: [{ login: 'testAssignee' }]
            },
            projectItems: { nodes: [] }  // Not in project
        };

        const actions = await processBoardItemRules(pr);
        
        assert.equal(actions.length, 1);
        assert.equal(actions[0].action, 'add_to_board');
        assert.deepEqual(actions[0].params, { item: pr });
        assert.ok(logMessages.some(msg => msg.includes('Adding PullRequest #123 to board')));
    });

    await t.test('skips PR when already in project', async () => {
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            assignees: { 
                nodes: [{ login: 'testAssignee' }]
            },
            projectItems: { nodes: [{ id: 'some-id' }] }  // Already in project
        };

        const actions = await processBoardItemRules(pr);
        
        assert.equal(actions.length, 0);
        assert.ok(logMessages.some(msg => msg.includes('Skipping PullRequest #123 - Already in project')));
    });

    await t.test('skips PR when not assigned to monitored user', async () => {
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            assignees: { 
                nodes: [{ login: 'otherUser' }]
            },
            projectItems: { nodes: [] }
        };

        const actions = await processBoardItemRules(pr);
        
        assert.equal(actions.length, 0);
    });
});
