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
  const items = await getRecentItems(org, repos, monitoredUser);
  const addedItems = [];
  const skippedItems = [];
  const monitoredRepos = new Set(repos.map(repo => `${org}/${repo}`));

  for (const item of items) {
    try {
      // First check if we should add this item based on rules
      if (!shouldAddItemToProject(item, monitoredUser, monitoredRepos)) {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          reason: 'Does not match add criteria'
        });
        continue;
      }

      // Then check if already in project
      const { isInProject } = await isItemInProject(item.id, projectId);
      if (isInProject) {
        skippedItems.push({
          type: item.__typename,
          number: item.number,
          repo: item.repository.nameWithOwner,
          reason: 'Already in project board'
        });
        continue;
      }

      // Add item to project since it meets criteria and isn't already there
      await addItemToProject(item.id, projectId);
      
      // Determine the reason for adding
      const reason = item.__typename === 'PullRequest' 
        ? item.author?.login === monitoredUser
          ? 'PR authored by monitored user'
          : item.assignees.nodes.some(a => a.login === monitoredUser)
            ? 'PR assigned to monitored user'
            : 'PR in monitored repository'
        : 'Issue in monitored repository';
      
      addedItems.push({
        type: item.__typename,
        number: item.number,
        repo: item.repository.nameWithOwner,
        reason
      });

    } catch (error) {
      log.error(`Failed to process ${item.__typename} #${item.number}: ${error.message}`);
    }
  }

  // Log results
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

  // First check if it's in a monitored repository
  if (monitoredRepos.has(repoFullName)) {
    return true;
  }

  // If it's a PR, check author and assignee conditions
  if (item.__typename === 'PullRequest') {
    const isAuthor = item.author?.login === monitoredUser;
    const isAssignee = item.assignees.nodes.some(a => a.login === monitoredUser);
    return isAuthor || isAssignee;
  }

  // Issues only get added if they're in monitored repos (handled above)
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
