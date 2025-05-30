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
  log.info(`Fetching recent items for org: ${org}, monitored user: ${monitoredUser}`);
  const items = await getRecentItems(org, repos, monitoredUser);
  log.info(`Found ${items.length} items to process`);

  const addedItems = [];
  const skippedItems = [];
  const monitoredRepos = new Set(repos.map(repo => `${org}/${repo}`));
  log.info(`Monitoring repositories: ${[...monitoredRepos].join(', ')}`);

  for (const item of items) {
    try {
      log.info(`\nEvaluating ${item.__typename} #${item.number}:`);
      log.info(`→ Location: ${item.repository.nameWithOwner}`);
      log.info(`→ Created by: ${item.author?.login || 'unknown'}`);
      log.info(`→ Current assignees: ${item.assignees?.nodes?.map(a => a.login).join(', ') || 'none'}`);
      log.info(`→ Monitored repos: ${[...monitoredRepos].join(', ')}`);
      log.info(`→ Monitored user: ${monitoredUser}`);

      // Log qualifying conditions
      const isMonitoredRepo = monitoredRepos.has(item.repository.nameWithOwner);
      const isAuthoredByUser = item.author?.login === monitoredUser;
      const isAssignedToUser = item.assignees?.nodes?.some(a => a.login === monitoredUser) || false;
      
      log.info('Checking qualifying conditions:');
      log.info(`→ In monitored repo? ${isMonitoredRepo ? 'Yes' : 'No'}`);
      if (item.__typename === 'PullRequest') {
        log.info(`→ Authored by monitored user? ${isAuthoredByUser ? 'Yes' : 'No'}`);
        log.info(`→ Assigned to monitored user? ${isAssignedToUser ? 'Yes' : 'No'}`);
      }
      
      // First check if we should add this item based on rules
      const shouldAdd = shouldAddItemToProject(item, monitoredUser, monitoredRepos);
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
      
      log.info(`Decision: ${shouldAdd ? 'Will be added' : 'Will be skipped'} - ${addReason}`);
      
      if (!shouldAdd) {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          reason: addReason
        });
        log.info(`⨯ Skipping ${item.__typename} #${item.number} - ${addReason}`);
        continue;
      }

      // Then check if already in project
      log.info(`Checking if ${item.__typename} #${item.number} is already in project...`);
      const { isInProject } = await isItemInProject(item.id, projectId);
      log.info(`${item.__typename} #${item.number} in project? ${isInProject}`);
      
      if (isInProject) {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          reason: 'Already in project board'
        });
        continue;
      }

      log.info(`✓ Adding to project board: ${item.__typename} #${item.number}`);
      log.info(`  Reason: ${addReason}`);
      
      // Add item to project since it meets criteria and isn't already there
      await addItemToProject(item.id, projectId);
      
      const reason = addReason; // Use the same reason we determined earlier
      
      addedItems.push({
        type: item.__typename,
        number: item.number,
        repo: item.repository.nameWithOwner,
        reason
      });
      log.info(`Successfully added ${item.__typename} #${item.number} - ${reason}`);

    } catch (error) {
      console.error('Full error:', error);
      log.error(`Failed to process ${item.__typename} #${item.number}: ${error.message}`);
      log.debug(`Error details: ${error.stack}`);
      // If this is an authentication error, stop processing
      if (error.message.includes('Bad credentials') || error.message.includes('Not authenticated')) {
        throw new Error('GitHub authentication failed. Please check GH_TOKEN environment variable.');
      }
    }
  }

  // Log summary
  log.info(`\nProcessing Summary:`);
  log.info(`Total items processed: ${items.length}`);
  log.info(`Items added: ${addedItems.length}`);
  log.info(`Items skipped: ${skippedItems.length}\n`);

  // Log detailed results
  addedItems.forEach(item => {
    log.info(`Added ${item.type} #${item.number} [${item.repo}] - ${item.reason}`);
  });

  skippedItems.forEach(item => {
    log.info(`Skipped ${item.type} #${item.number} [${item.repo}] - ${item.reason}`);
  });

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
  if (monitoredRepos.has(repoFullName)) {
    log.debug(`${item.__typename} #${item.number} is in monitored repository ${repoFullName}`);
    return true;
  }

  // If it's a PR, check author and assignee conditions
  if (item.__typename === 'PullRequest') {
    const isAuthor = item.author?.login === monitoredUser;
    const isAssignee = item.assignees.nodes.some(a => a.login === monitoredUser);
    
    log.debug(`PR #${item.number} authored by: ${item.author?.login || 'unknown'}`);
    log.debug(`PR #${item.number} assignees: ${item.assignees.nodes.map(a => a.login).join(', ') || 'none'}`);
    log.debug(`PR #${item.number} criteria check:
      - Is author (${monitoredUser})? ${isAuthor}
      - Is assignee? ${isAssignee}
      - In monitored repo? ${monitoredRepos.has(repoFullName)}`);
    
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
