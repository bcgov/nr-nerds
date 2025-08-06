// Ensure test runner is available
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('PR authored by monitored user rule', async (t) => {
    let processBoardItemRules;
    let config;
    let createMockPR;
    const logMessages = [];

    // Setup test environment and mocks before each test
    t.beforeEach(() => {
        // Mock our dependencies
        const { loadBoardRules } = require('../../../config/board-rules');

        // Set up environment with config values
        process.env.GITHUB_AUTHOR = 'DerekRoberts';

        // Set up fake module cache for mocks
        const validatorPath = require.resolve('../shared-validator');
        const rulesPath = require.resolve('../../../config/board-rules');
        const logPath = require.resolve('../../../utils/log');

        require.cache[ validatorPath ] = {
            exports: {
                validator: {
                    validateItemCondition: (item, trigger) => {
                        if (trigger.condition === 'monitored.users.includes(item.author)') {
                            return item.author?.login === process.env.GITHUB_AUTHOR;
                        }
                        return false;
                    }
                }
            }
        };

        require.cache[ rulesPath ] = {
            exports: {
                loadBoardRules: () => ({
                    rules: {
                        board_items: [ {
                            name: "PullRequest by Author",
                            description: "Add pull requests authored by monitored user",
                            trigger: {
                                type: "PullRequest",
                                condition: "monitored.users.includes(item.author)"
                            },
                            action: "add_to_board",
                            skip_if: "item.inProject"
                        } ]
                    },
                    monitoredUsers: ['DerekRoberts']
                })
            }
        };

        require.cache[ logPath ] = {
            exports: {
                log: {
                    info: (msg) => logMessages.push(msg),
                    debug: (msg) => logMessages.push(msg),
                    error: (msg) => logMessages.push(msg)
                }
            }
        };

        // Import module under test
        try {
            const boardItems = require('../board-items');
            processBoardItemRules = boardItems.processBoardItemRules;
        } catch (err) {
            console.error('Failed to load board-items:', err);
            throw err;
        }

        // Simple mock PR creation function
        createMockPR = async (overrides = {}) => {
            return {
                __typename: 'PullRequest',
                number: 123,
                author: { login: 'DerekRoberts' },
                repository: { nameWithOwner: 'test-org/test-repo' },
                projectItems: { nodes: [] },
                ...overrides
            };
        };

        // Clear log messages
        logMessages.length = 0;
    });

    t.afterEach(() => {
        // Clear mocks
        delete require.cache[require.resolve('../shared-validator')];
        delete require.cache[require.resolve('../../../config/board-rules')];
        delete require.cache[require.resolve('../../../utils/log')];
    });

    await t.test('adds PR to board when authored by monitored user', async () => {
        const testPR = await createMockPR({
            number: 123,
            repository: { nameWithOwner: 'test-org/test-repo' },
            projectItems: { nodes: [] }
        });

        const actions = await processBoardItemRules(testPR);

        assert.equal(actions.length, 1, 'should add PR to board');
        assert.equal(actions[ 0 ].action, 'add_to_board', 'action should be add_to_board');
        assert.deepEqual(actions[ 0 ].params, { item: testPR }, 'should include PR in params');
        assert.ok(logMessages.some(msg => msg.includes('Adding PullRequest #123 to board')),
            'should log board addition');
    });

    await t.test('skips PR when already in project', async () => {
        const testPR = await createMockPR({
            number: 123,
            repository: { nameWithOwner: 'test-org/test-repo' },
            projectItems: { nodes: [ { id: 'exists' } ] }
        });

        const actions = await processBoardItemRules(testPR);

        assert.equal(actions.length, 0, 'should skip PR already in project');
        assert.ok(logMessages.some(msg => msg.includes('Skipping PullRequest #123')),
            'should log skip reason');
    });

    await t.test('skips PR when author is not monitored user', async () => {
        const testPR = await createMockPR({
            number: 123,
            author: { login: 'otherUser' },
            repository: { nameWithOwner: 'test-org/test-repo' },
            projectItems: { nodes: [] }
        });

        const actions = await processBoardItemRules(testPR);

        assert.equal(actions.length, 0, 'should skip PR from non-monitored author');
    });
});
