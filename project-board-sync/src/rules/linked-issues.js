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
          closingIssuesReferences(first: 10) {
            nodes {
              id
              number
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

  return result.repository.pullRequest.closingIssuesReferences.nodes || [];
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
    return { processed: 0, errors: 0 };
  }

  const [owner, repo] = item.repository.nameWithOwner.split('/');
  const linkedIssues = await getLinkedIssues(owner, repo, item.number);
  let processed = 0;
  let errors = 0;

  for (const issue of linkedIssues) {
    try {        // Add to project if not already there
        const context = { 
          processedIds: new Set(),
          monitoredUser: process.env.GITHUB_AUTHOR,
          monitoredRepos: new Set([item.repository.nameWithOwner])
        };
        const addResult = await processItemForProject(issue, projectId, context);

        if (addResult.added || addResult.projectItemId) {
          const itemId = addResult.projectItemId;

          // Sync column if needed
          if (currentColumn) {
            try {
              // We need to get the actual column option ID, not just the name
              const { getColumnOptionId } = require('../github/api');
              const columnOptionId = await getColumnOptionId(projectId, currentColumn);
              
              if (columnOptionId) {
                await setItemColumn(projectId, itemId, columnOptionId);
                log.info(`Set linked issue #${issue.number} column to ${currentColumn}`);
              } else {
                log.error(`Failed to find column option ID for ${currentColumn}`);
              }
            } catch (error) {
              log.error(`Failed to set column for linked issue #${issue.number}: ${error.message}`);
            }
          }

          // Sync sprint if needed
          if (currentSprintId) {
            await setItemSprint(projectId, itemId, currentSprintId);
            log.info(`Set linked issue #${issue.number} sprint to match PR #${item.number}`);
          }
          
          // Get PR assignees - we need the PR's project item ID
          // The PR's project item ID should be passed from index.js
          if (item.projectItemId) {
            try {
              const prAssignees = await getItemAssignees(projectId, item.projectItemId);
              
              if (prAssignees && prAssignees.length > 0) {
                // Transfer assignees to linked issue
                await setItemAssignees(projectId, itemId, prAssignees);
                log.info(`Set linked issue #${issue.number} assignees to match PR #${item.number}: ${prAssignees.join(', ')}`);
              } else {
                log.info(`PR #${item.number} has no assignees to transfer to linked issue #${issue.number}`);
              }
            } catch (error) {
              log.error(`Failed to transfer assignees from PR #${item.number} to issue #${issue.number}: ${error.message}`);
            }
          } else {
            log.warn(`Cannot transfer assignees: PR #${item.number} has no project item ID`);
          }

          processed++;
          log.info(`Synchronized linked issue #${issue.number} with PR #${item.number}`);
      }
    } catch (error) {
      log.error(`Failed to process linked issue #${issue.number}: ${error.message}`);
      errors++;
    }
  }

  return { processed, errors };
}

module.exports = {
  processLinkedIssues,
  getLinkedIssues
};
