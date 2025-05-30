const { getRecentItems, log } = require('./github/api');
const { processItemForProject } = require('./rules/add-items');
const { processColumnAssignment } = require('./rules/columns');
const { processSprintAssignment } = require('./rules/sprints');
const { processAssignees } = require('./rules/assignees');
const { processLinkedIssues } = require('./rules/linked-issues');

/**
 * Project Board Sync Main Function
 * Implements all five rule sets from requirements.md:
 * 1. Which Items are Added (Board Addition Rules)
 * 2. Which Columns Items Go To (Column Rules)
 * 3. Sprint Assignment Rules
 * 4. Linked Issue Rules
 * 5. Assignee Rules
 */
async function main() {
  try {
    // Initialize context
    const context = {
      org: 'bcgov',
      repos: [
        'nr-nerds',
        'quickstart-openshift',
        'quickstart-openshift-backends',
        'quickstart-openshift-helpers'
      ],
      monitoredUser: process.env.GITHUB_AUTHOR,
      processedIds: new Set(),
      projectId: process.env.PROJECT_ID || 'PVT_kwDOAA37OM4AFuzg'
    };

    log.info('Starting Project Board Sync...');
    log.info(`User: ${context.monitoredUser}`);
    log.info(`Project: ${context.projectId}`);
    log.info('Monitored Repos:', context.repos.join(', '));

    // 1. Get recent items from monitored repos
    const items = await getRecentItems(context.org, context.repos, context.monitoredUser);
    log.info(`Found ${items.length} items to process`);

    for (const item of items) {
      try {
        // 2. Add item to project if needed
        const addResult = await processItemForProject(item, context.projectId, context);
        
        if (!addResult.added && !addResult.projectItemId) {
          log.info(`Skipped ${item.__typename} #${item.number}: ${addResult.reason}`);
          continue;
        }

        const itemId = addResult.projectItemId;
        const itemRef = `${item.__typename} #${item.number}`;

        // 3. Set initial column
        const columnResult = await processColumnAssignment(item, itemId, context.projectId);
        if (columnResult.changed) {
          log.info(`Set column for ${itemRef} to ${columnResult.newStatus}`);
        }

        // 4. Assign sprint if needed
        const sprintResult = await processSprintAssignment(
          item, 
          itemId, 
          context.projectId, 
          columnResult.newStatus
        );
        if (sprintResult.changed) {
          log.info(`Set sprint for ${itemRef} to ${sprintResult.newSprint}`);
        }

        // 5. Handle assignees
        const assigneeResult = await processAssignees(item, context.projectId, itemId);
        if (assigneeResult.changed) {
          log.info(`Updated assignees for ${itemRef}: ${assigneeResult.assignees.join(', ')}`);
        }

        // 6. Process linked issues if it's a PR
        if (item.__typename === 'PullRequest') {
          const linkedResult = await processLinkedIssues(
            item, 
            context.projectId,
            columnResult.newStatus,
            sprintResult.newSprint
          );
          if (linkedResult.processed > 0) {
            log.info(`Processed ${linkedResult.processed} linked issues for ${itemRef}`);
          }
          if (linkedResult.errors > 0) {
            log.warn(`Failed to process ${linkedResult.errors} linked issues for ${itemRef}`);
          }
        }

      } catch (error) {
        log.error(`Error processing ${item.__typename} #${item.number}:`, error.message);
      }
    }

    log.info('Project Board Sync completed successfully.');
  } catch (error) {
    log.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    log.error('Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { main };
