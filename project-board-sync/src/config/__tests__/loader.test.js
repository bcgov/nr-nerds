const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ConfigLoader = require('../loader');

test('ConfigLoader', async (t) => {
  await t.test('loads valid config from rules.yml', async () => {
    const loader = new ConfigLoader();
    const config = loader.load(path.join(__dirname, '../../../config/rules.yml'));

    // Basic structure checks - no version field in new structure
    assert.ok(config.project, 'has project section');
    assert.ok(config.automation, 'has automation section');
    assert.ok(config.technical, 'has technical section');

    // Project settings
    assert.equal(config.project.id, 'PVT_kwDOAA37OM4AFuzg', 'correct project ID');

    // Automation structure
    assert.ok(config.automation.user_scope, 'has user_scope');
    assert.ok(config.automation.user_scope.monitored_user, 'has monitored_user');
    assert.ok(config.automation.user_scope.monitored_user.name, 'has monitored user name');
    assert.ok([ 'static', 'env' ].includes(config.automation.user_scope.monitored_user.type), 'has valid user type');
    assert.ok(config.automation.user_scope.monitored_user.description, 'has user description');
    assert.ok(config.automation.repository_scope, 'has repository_scope');
    assert.equal(config.automation.repository_scope.organization, 'bcgov', 'correct organization');
    assert.ok(Array.isArray(config.automation.repository_scope.repositories), 'has repository list');
    assert.ok(config.automation.repository_scope.repositories.includes('nr-nerds'), 'includes current repo');

    // After normalization through loadBoardRules, check merged rules
    const { loadBoardRules } = require('../board-rules');
    const normalizedConfig = loadBoardRules();

    const ruleSections = [ 'board_items', 'columns', 'sprints', 'linked_issues', 'assignees' ];
    for (const section of ruleSections) {
      assert.ok(Array.isArray(normalizedConfig.rules[ section ]), `has ${section} rules`);
      assert.ok(normalizedConfig.rules[ section ].length > 0, `${section} has rules defined`);
    }

    // Technical settings
    assert.equal(config.technical.batch_size, 10, 'correct batch size');
    assert.equal(config.technical.update_window_hours, 24, 'correct update window');
    assert.ok(config.technical.optimization.skip_unchanged, 'optimization enabled');
  });
});
