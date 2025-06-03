const { isItemInProject, addItemToProject, getRecentItems } = require('../github/api');
const { log } = require('../utils/log');

/**
 * Implementation of Rule Set 1: Which Items are Added to the Project Board?
 * 
 * Rules from requirements.md:
 * | Item Type | Trigger Condition             | Action               | Skip Condition     |
 * |-----------|-------------------------------|----------------------|--------------------|
 * | PR        | Authored by monitored user    | Add to project board | Already in project |
 * | PR        | Assigned to monitored user    | Add to project board | Already in project |
 * | PR        | Found in monitored repository | Add to project board | Already in project |
 * | Issue     | Found in monitored repository | Add to project board | Already in project |
 */
async function processAddItems({ org, repos, monitoredUser, projectId }) {
  log.info(`Starting item processing for user ${monitoredUser}`);
  const items = await getRecentItems(org, repos, monitoredUser);
  log.info(`Found ${items.length} items to process\n`, true);

  const addedItems = [];
  const skippedItems = [];
  const monitoredRepos = new Set(repos.map(repo => `${org}/${repo}`));
  log.info(`📋 Monitoring repositories:\n${[...monitoredRepos].map(r => `  • ${r}`).join('\n')}\n`, true);

  for (const item of items) {
    try {
      const itemIdentifier = `${item.__typename} #${item.number} (${item.repository.nameWithOwner})`;
      log.info(`\n🔍 Processing: ${itemIdentifier}`, true);
      log.info(`  ├─ Author: ${item.author?.login || 'unknown'}`, true);
      log.info(`  └─ Assignees: ${item.assignees?.nodes?.map(a => a.login).join(', ') || 'none'}\n`, true);

      // Log qualifying conditions
      const isMonitoredRepo = monitoredRepos.has(item.repository.nameWithOwner);
      const isAuthoredByUser = item.author?.login === monitoredUser;
      const isAssignedToUser = item.assignees?.nodes?.some(a => a.login === monitoredUser) || false;
      
      log.info('  Checking conditions:', true);
      log.info(`  ├─ In monitored repo? ${isMonitoredRepo ? '✓ Yes' : '✗ No'}`, true);
      if (item.__typename === 'PullRequest') {
        log.info(`  ├─ Authored by ${monitoredUser}? ${isAuthoredByUser ? '✓ Yes' : '✗ No'}`, true);
        log.info(`  └─ Assigned to ${monitoredUser}? ${isAssignedToUser ? '✓ Yes' : '✗ No'}\n`, true);
      }
      
      // Check if we should add this item based on rules
      const boardActions = processBoardItemRules(item, { monitoredUser });
      const shouldAdd = boardActions.length > 0;
      const addReason = item.__typename === 'PullRequest'
        ? isAuthoredByUser 
          ? 'PR is authored by monitored user'
          : isAssignedToUser
            ? 'PR is assigned to monitored user'
            : isMonitoredRepo
              ? 'PR is in a monitored repository'
              : 'PR does not meet any criteria'
        : isMonitoredRepo
          ? 'Issue is in a monitored repository'
          : 'Issue does not meet any criteria';
      
      if (!shouldAdd) {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          reason: addReason
        });
        log.info(`  ⨯ Action Required: Skip - ${addReason}\n`, true);
        continue;
      }

      // Then check if already in project
      log.info('  Checking project board status...', true);
      const { isInProject } = await isItemInProject(item.id, projectId);
      
      if (isInProject) {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          reason: 'Already in project board'
        });
        log.info('  ℹ Status: Already in project board - no action needed\n', true);
        continue;
      }

      log.info('  ✨ Action Required: Add to project board', true);
      log.info(`     Reason: ${addReason}`, true);        // Add item to project since it meets criteria and isn't already there
      const projectItemId = await addItemToProject(item.id, projectId);
      
      addedItems.push({
        type: item.__typename,
        __typename: item.__typename,  // Preserve the typename for columns.js
        number: item.number,
        repo: item.repository.nameWithOwner,
        repository: item.repository, // <-- Add this line
        reason: addReason,
        id: item.id,
        projectItemId: projectItemId,
        author: item.author  // Pass author info for assignee rules
      });
      log.info('  ✓ Result: Successfully added to project board\n', true);

    } catch (error) {
      log.error(`Failed to process ${item.__typename} #${item.number}: ${error.message}`);
      log.debug(`Error details: ${error.stack}`);
      // If this is an authentication error, stop processing
      if (error.message.includes('Bad credentials') || error.message.includes('Not authenticated')) {
        throw new Error('GitHub authentication failed. Please check GH_TOKEN environment variable.');
      }
    }
  }

  // Log summary with more detail
  log.info('\n📊 Processing Summary', true);
  log.info(`━━━━━━━━━━━━━━━━━━━`, true);
  log.info(`Total items processed: ${items.length}`, true);
  
  if (addedItems.length > 0) {
    log.info('\n✓ Items Added:', true);
    addedItems.forEach(item => {
      log.info(`  • ${item.type} #${item.number} [${item.repo}]`, true);
      log.info(`    └─ ${item.reason}`, true);
    });
  }
  
  if (skippedItems.length > 0) {
    log.info('\nℹ Items Skipped:', true);
    skippedItems.forEach(item => {
      log.info(`  • ${item.type} #${item.number} [${item.repo}]`, true);
      log.info(`    └─ ${item.reason}`, true);
    });
  }
  
  log.info('\n━━━━━━━━━━━━━━━━━━━\n', true);

  return { addedItems, skippedItems };
}

/**
 * Determine if an item should be added to the project board based on requirements
 * @param {Object} item - The issue or PR
 * @param {string} monitoredUser - The GitHub username being monitored
 * @param {Set<string>} monitoredRepos - Set of monitored repository full names (e.g. 'bcgov/nr-nerds')
 * @returns {boolean} Whether the item should be added
 */
function shouldAddItemToProject(item, monitoredUser, monitoredRepos) {
  const repoFullName = item.repository.nameWithOwner;
  log.debug(`Checking ${item.__typename} #${item.number} from ${repoFullName}`);

  // First check if it's in a monitored repository
  const isMonitoredRepo = monitoredRepos.has(repoFullName);
  if (isMonitoredRepo) {
    log.debug(`${item.__typename} #${item.number} is in monitored repository ${repoFullName}`);
    return true;
  }

  // Check if assigned to monitored user (applies to both Issues and PRs)
  const isAssignee = item.assignees.nodes.some(a => a.login === monitoredUser);
  if (isAssignee) {
    log.debug(`${item.__typename} #${item.number} is assigned to ${monitoredUser}`);
    return true;
  }

  // Check PR-specific conditions
  if (item.__typename === 'PullRequest') {
    const isAuthor = item.author?.login === monitoredUser;
    
    log.debug(`PR #${item.number}:
      - Author: ${item.author?.login || 'unknown'}
      - Is author? ${isAuthor}
      - Is assignee? ${isAssignee}
      - In monitored repo? ${isMonitoredRepo}`);
    
    return isAuthor || isAssignee;
  }

  log.debug(`${item.__typename} #${item.number} does not meet any criteria for inclusion`);
  return false;
}

/**
 * Add an item to the project board based on requirements
 * @param {Object} item - The issue or PR to potentially add
 * @param {string} projectId - The project board ID
 * @param {Object} context - Additional context (monitoredUser, repos, etc)
 * @returns {Promise<{added: boolean, projectItemId?: string}>} Whether item was added and its ID
 */
async function processItemForProject(item, projectId, context) {
  // Skip if already processed
  if (context.processedIds.has(item.id)) {
    return { added: false, reason: 'Already processed' };
  }
  context.processedIds.add(item.id);

  // Check if it should be added based on requirements
  if (!shouldAddItemToProject(item, context.monitoredUser, context.monitoredRepos)) {
    return { added: false, reason: 'Does not match add criteria' };
  }

  // Check if already in project
  const { isInProject, projectItemId } = await isItemInProject(item.id, projectId);
  if (isInProject) {
    return { added: false, projectItemId, reason: 'Already in project' };
  }

  // Add to project
  const newProjectItemId = await addItemToProject(item.id, projectId);
  return { 
    added: true, 
    projectItemId: newProjectItemId,
    reason: `Added as ${item.__typename} from ${item.repository.nameWithOwner}`
  };
}

// Export all functions for use in tests and main app
module.exports = {
  processAddItems,
  processItemForProject,
  shouldAddItemToProject
};
