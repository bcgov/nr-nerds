const { octokit } = require('../github/api');
const { log } = require('../utils/log');
const { processItemForProject } = require('./add-items');
const { setItemColumn } = require('../github/api');
const { setItemSprint } = require('./sprints');

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
    try {
      // Add to project if not already there
      const addResult = await processItemForProject(issue, projectId);

      if (addResult.added || addResult.projectItemId) {
        const itemId = addResult.projectItemId;

        // Sync column if needed
        if (currentColumn) {
          await setItemColumn(projectId, itemId, currentColumn);
        }

        // Sync sprint if needed
        if (currentSprintId) {
          await setItemSprint(projectId, itemId, currentSprintId);
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
