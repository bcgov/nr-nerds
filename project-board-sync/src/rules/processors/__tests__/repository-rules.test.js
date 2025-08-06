const { test } = require('node:test');
const assert = require('node:assert/strict');

test('PR/Issue from monitored repository rule', async (t) => {
    // Shared variables for all sub-tests
    let processBoardItemRules;
    const logMessages = [];
    
    // Setup test environment and mocks before each test
    t.beforeEach(() => {
        // Mock dependencies using require.cache
        const sharedValidatorPath = require.resolve('../shared-validator');
        const boardRulesPath = require.resolve('../../../config/board-rules');
        const logPath = require.resolve('../../../utils/log');
        
        require.cache[sharedValidatorPath] = {
            exports: {
                validator: {
                    validateItemCondition: (item, trigger) => {
                        if (trigger.condition === 'item.repository === monitored.repository') {
                            return item.repository?.name === process.env.GITHUB_REPOSITORY;
                        }
                        return false;
                    },
                    validateSkipRule: (item, skipIf) => {
                        if (skipIf === "item.inProject") {
                            return item.projectItems?.nodes?.length > 0;
                        }
                        return false;
                    },
                    steps: {
                        markStepComplete: (step) => {
                            // Mock implementation
                        }
                    }
                }
            }
        };
        
        require.cache[boardRulesPath] = {
            exports: {
                loadBoardRules: () => ({
                    rules: {
                        board_items: [{
                            name: "Items from Repository",
                            description: "Add items from monitored repository",
                            trigger: {
                                type: "PullRequest|Issue",
                                condition: "item.repository === monitored.repository"
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
                    debug: (msg) => logMessages.push(msg),
                    error: (msg) => logMessages.push(msg)
                }
            }
        };

        // Set test environment
        process.env.GITHUB_REPOSITORY = 'test-repo';
        
        // Clear log messages
        logMessages.length = 0;
        
        // Import after mocks are set up
        const boardItems = require('../unified-rule-processor');
        processBoardItemRules = boardItems.processBoardItemRules;
    });

    t.afterEach(() => {
        // Clear mocks
        delete require.cache[require.resolve('../shared-validator')];
        delete require.cache[require.resolve('../../../config/board-rules')];
        delete require.cache[require.resolve('../../../utils/log')];
    });

    await t.test('adds PR to board when from monitored repository', async () => {
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            repository: { name: 'test-repo' },
            projectItems: { nodes: [] }  // Not in project
        };

        const actions = await processBoardItemRules(pr);
        
        assert.equal(actions.length, 1);
        assert.equal(actions[0].action, 'add_to_board');
        assert.deepEqual(actions[0].params, { item: pr });
        assert.ok(logMessages.some(msg => msg.includes('Rule Items from Repository triggered for PullRequest #123')));
    });

    await t.test('adds Issue to board when from monitored repository', async () => {
        const issue = {
            __typename: 'Issue',
            number: 456,
            repository: { name: 'test-repo' },
            projectItems: { nodes: [] }  // Not in project
        };

        const actions = await processBoardItemRules(issue);
        
        assert.equal(actions.length, 1);
        assert.equal(actions[0].action, 'add_to_board');
        assert.deepEqual(actions[0].params, { item: issue });
        assert.ok(logMessages.some(msg => msg.includes('Rule Items from Repository triggered for Issue #456')));
    });

    await t.test('skips item when already in project', async () => {
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            repository: { name: 'test-repo' },
            projectItems: { nodes: [{ id: 'some-id' }] }  // Already in project
        };

        const actions = await processBoardItemRules(pr);
        
        assert.equal(actions.length, 0);
        assert.ok(logMessages.some(msg => msg.includes('Skipping PullRequest #123 - Already in project')));
    });

    await t.test('skips item when not from monitored repository', async () => {
        const pr = {
            __typename: 'PullRequest',
            number: 123,
            repository: { name: 'other-repo' },
            projectItems: { nodes: [] }
        };

        const actions = await processBoardItemRules(pr);
        
        assert.equal(actions.length, 0);
    });
});
