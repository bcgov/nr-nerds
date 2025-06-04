const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ConfigLoader } = require('../loader');

test('ConfigLoader', async (t) => {
  await t.test('loads valid config from rules.yml', async () => {
    const loader = new ConfigLoader();
    const config = loader.load(path.join(__dirname, '../../../config/rules.yml'));

    // Basic structure checks
    assert.ok(config.version, 'has version');
    assert.ok(config.project, 'has project section');
    assert.ok(config.rules, 'has rules section');
    assert.ok(config.technical, 'has technical section');

    // Project settings
    assert.equal(config.project.organization, 'bcgov', 'correct organization');
    assert.equal(config.project.id, 'PVT_kwDOAA37OM4AFuzg', 'correct project ID');
    assert.ok(Array.isArray(config.project.repositories), 'has repository list');
    assert.ok(config.project.repositories.includes('nr-nerds'), 'includes current repo');

    // Rules structure
    const ruleSections = ['board_items', 'columns', 'sprints', 'linked_issues', 'assignees'];
    for (const section of ruleSections) {
      assert.ok(Array.isArray(config.rules[section]), `has ${section} rules`);
      assert.ok(config.rules[section].length > 0, `${section} has rules defined`);
    }

    // Technical settings
    assert.equal(config.technical.batch_size, 10, 'correct batch size');
    assert.equal(config.technical.update_window_hours, 24, 'correct update window');
    assert.ok(config.technical.optimization.skip_unchanged, 'optimization enabled');
  });
});
