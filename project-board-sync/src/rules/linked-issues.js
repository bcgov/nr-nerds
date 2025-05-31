const { octokit } = require('../github/api');
const { log } = require('../utils/log');
const { processItemForProject } = require('./add-items');
const { setItemColumn } = require('../github/api');
const { setItemSprint } = require('./sprints');
const { getItemAssignees, setItemAssignees } = require('./assignees');

/**
 * Get linked issues for a PR
 * @param {string} org - The GitHub organization
 * @param {string} repo - The repository name
 * @param {number} prNumber - The PR number
 * @returns {Promise<Array<{id: string, number: number}>>} Array of linked issues
 */
async function getLinkedIssues(org, repo, prNumber) {
  const result = await octokit.graphql(`
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          body
          closingIssuesReferences(first: 10) {
            nodes {
              id
              number
              title
              repository {
                nameWithOwner
              }
            }
          }
        }
      }
    }
  `, {
    owner: org,
    repo,
    number: prNumber
  });

  const pr = result.repository.pullRequest;
  const linked = pr.closingIssuesReferences.nodes || [];
  log.info(`[Linked Issues] === PR #${prNumber} Linked Issues Check ===`);
  log.info(`[Linked Issues] PR body: ${pr.body ? pr.body.replace(/\n/g, ' ') : '[empty]'}`);
  if (linked.length === 0) {
    log.warning(`[Linked Issues] No linked issues found for PR #${prNumber}.`);
    if (pr.body && pr.body.includes('#')) {
      log.warning(`[Linked Issues] PR #${prNumber} body contains references (e.g. #76) but no closing keywords. Use 'closes #76' or 'fixes #76'.`);
    }
  } else {
    log.info(`[Linked Issues] PR #${prNumber} links to issues:`);
    linked.forEach(issue => {
      log.info(`  - #${issue.number}: ${issue.title || '[no title]'} [${issue.repository.nameWithOwner}]`);
    });
  }
  return linked;
}

/**
 * Implementation of Rule Set 4: Linked Issue Rules
 * 
 * Rules:
 * - When a PR is linked to issues using closing keywords, those issues should inherit:
 *   1. The same column as the PR
 *   2. The same sprint as the PR
 *   3. The same assignee(s) as the PR
 * 
 * @param {Object} item - The PR
 * @param {string} projectId - The project board ID
 * @param {string} currentColumn - Current column of the PR
 * @param {string} currentSprintId - Current sprint ID of the PR
 * @returns {Promise<{processed: number, errors: number}>}
 */
async function processLinkedIssues(item, projectId, currentColumn, currentSprintId) {
  if (item.__typename !== 'PullRequest') {
    log.info(`[Linked Issues] Skipping non-PR item for linked issue processing.`);
    return { processed: 0, errors: 0 };
  }

  const [owner, repo] = item.repository.nameWithOwner.split('/');
  log.info(`[Linked Issues] === Begin processing for PR #${item.number} (${owner}/${repo}) ===`);
  const linkedIssues = await getLinkedIssues(owner, repo, item.number);
  if (linkedIssues.length === 0) {
    log.warning(`[Linked Issues] No linked issues to process for PR #${item.number}.`);
  } else {
    log.info(`[Linked Issues] Will attempt to inherit column and assignees for: ${linkedIssues.map(i => '#' + i.number).join(', ')}`);
  }
  let processed = 0;
  let errors = 0;

  log.info(`\n[Linked Issues] PR #${item.number} projectItemId: ${item.projectItemId || 'MISSING'}`);
  log.info(`[Linked Issues] PR #${item.number} currentColumn: ${currentColumn || 'MISSING'}`);

  for (const issue of linkedIssues) {
    try {
      const context = {
        processedIds: new Set(),
        monitoredUser: process.env.GITHUB_AUTHOR,
        monitoredRepos: new Set([item.repository.nameWithOwner])
      };
      const addResult = await processItemForProject(issue, projectId, context);
      if (addResult.added || addResult.projectItemId) {
        const itemId = addResult.projectItemId;
        // --- COLUMN INHERITANCE ---
        if (currentColumn) {
          try {
            const { getColumnOptionId, getItemColumn } = require('../github/api');
            const columnOptionId = await getColumnOptionId(projectId, currentColumn);
            log.info(`[Linked Issues] Issue #${issue.number} projectItemId before column update: ${itemId}`);
            if (columnOptionId) {
              const setResult = await setItemColumn(projectId, itemId, columnOptionId);
              if (!setResult || !setResult.updateProjectV2ItemFieldValue || !setResult.updateProjectV2ItemFieldValue.projectV2Item) {
                log.warning(`[Linked Issues] setItemColumn did not update item #${issue.number}. Full response: ${JSON.stringify(setResult)}`);
              } else {
                log.info(`[Linked Issues] Set linked issue #${issue.number} column to ${currentColumn}`);
              }
              // Fetch and log the current column after update
              const afterColumn = await getItemColumn(projectId, itemId);
              log.info(`[Linked Issues] Issue #${issue.number} column after update: ${afterColumn}`);
              // --- SPRINT ASSIGNMENT ---
              const { processSprintAssignment, getItemSprint } = require('./sprints');
              const sprintResult = await processSprintAssignment(
                issue,
                itemId,
                projectId,
                afterColumn
              );
              if (sprintResult.changed) {
                log.info(`[Linked Issues] Set sprint for linked issue #${issue.number} to ${sprintResult.newSprint}`);
              } else {
                log.info(`[Linked Issues] Sprint for linked issue #${issue.number} not changed: ${sprintResult.reason}`);
              }
              // Fetch and log the current sprint after update
              const afterSprint = await getItemSprint(projectId, itemId);
              log.info(`[Linked Issues] Issue #${issue.number} sprint after update: ${afterSprint.sprintTitle || 'none'}`);
            } else {
              log.error(`[Linked Issues] Column '${currentColumn}' not found for project. Check available columns.`);
            }
          } catch (error) {
            log.error(`[Linked Issues] Failed to set column or sprint for linked issue #${issue.number}: ${error.stack || error}`);
          }
        } else {
          log.warning(`[Linked Issues] No currentColumn provided for PR #${item.number}, cannot inherit column for issue #${issue.number}`);
        }
        // --- ASSIGNEE INHERITANCE ---
        if (item.projectItemId) {
          try {
            const { getItemAssignees, setItemAssignees } = require('./assignees');
            const prAssignees = await getItemAssignees(projectId, item.projectItemId);
            log.info(`[Linked Issues] PR #${item.number} assignees: ${prAssignees.join(', ') || 'none'}`);
            if (prAssignees && prAssignees.length > 0) {
              const assigneeResult = await setItemAssignees(projectId, itemId, prAssignees);
              log.info(`[Linked Issues] setItemAssignees response: ${JSON.stringify(assigneeResult)}`);
              log.info(`[Linked Issues] Set linked issue #${issue.number} assignees to match PR #${item.number}: ${prAssignees.join(', ')}`);
              // Fetch and log the current assignees after update
              const afterAssignees = await getItemAssignees(projectId, itemId);
              log.info(`[Linked Issues] Issue #${issue.number} assignees after update: ${afterAssignees.join(', ')}`);
            } else {
              log.warning(`[Linked Issues] No assignees found on PR #${item.number} project item for inheritance to issue #${issue.number}`);
            }
          } catch (error) {
            log.error(`[Linked Issues] Failed to transfer assignees from PR #${item.number} to issue #${issue.number}: ${error.stack || error}`);
          }
        } else {
          log.warning(`[Linked Issues] PR #${item.number} has no projectItemId, cannot inherit assignees for issue #${issue.number}`);
        }
        processed++;
        log.info(`[Linked Issues] Synchronized linked issue #${issue.number} with PR #${item.number}`);
      } else {
        log.warning(`[Linked Issues] Issue #${issue.number} could not be added to project: ${addResult.reason}`);
      }
    } catch (error) {
      log.error(`[Linked Issues] Failed to process linked issue #${issue.number}: ${error.message}`);
      errors++;
    }
  }
  return { processed, errors };
}

module.exports = {
  processLinkedIssues,
  getLinkedIssues
};
