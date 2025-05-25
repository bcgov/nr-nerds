// Minimal script: assign all open/closed PRs by GITHUB_AUTHOR to GITHUB_AUTHOR using REST API
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';
const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

// === CONFIGURATION ===
const STATUS_OPTIONS = {
  active: 'c66ba2dd', // Project column optionId for 'Active'
  done: 'b6e2e2b2'   // Project column optionId for 'Done' (update as needed)
};
const VERBOSE = process.argv.includes('--verbose');
// REMINDER: Consider TypeScript and more unit tests in future for maintainability and safety.

let globalErrors = [];
let globalSummary = [];

// Helper to get the current sprint iteration ID (the one whose startDate is closest to today but not in the future)
function getCurrentSprintIterationId(iterations) {
  const today = new Date();
  let current = null;
  for (const iter of iterations) {
    const start = new Date(iter.startDate);
    const end = new Date(start);
    end.setDate(start.getDate() + iter.duration);
    if (start <= today && today < end) {
      current = iter.id;
      break;
    }
  }
  return current;
}

// Helper to ensure a current sprint exists (today is within a sprint window)
let cachedCurrentSprintId = null;
async function ensureCurrentSprintExists(sprintField) {
  if (!sprintField || !sprintField.configuration) return;
  const iterations = sprintField.configuration.iterations;
  if (cachedCurrentSprintId === null) {
    cachedCurrentSprintId = getCurrentSprintIterationId(iterations);
  }
  if (!cachedCurrentSprintId) {
    console.error('\nERROR: No current sprint is available. Please create a sprint in the GitHub UI that includes today.');
    process.exit(1);
  }
}

// Helper to add an item (PR or issue) to project and set status and sprint
async function addItemToProjectAndSetStatus(nodeId, type, number, sprintField, logPrefix = '', repoName = '', prState = null, prMerged = false) {
  try {
    // Paginate through project items to check if this nodeId is already present
    let projectItemId = null;
    let endCursor = null;
    let found = false;
    do {
      const existingItemQuery = await octokit.graphql(`
        query($projectId:ID!, $after:String) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: 100, after: $after) {
                nodes { id content { ... on PullRequest { id } ... on Issue { id } } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `, {
        projectId: PROJECT_ID,
        after: endCursor
      });
      const items = existingItemQuery.node.items.nodes;
      const match = items.find(item => item.content && item.content.id === nodeId);
      if (match) {
        projectItemId = match.id;
        found = true;
        break;
      }
      endCursor = existingItemQuery.node.items.pageInfo.endCursor;
    } while (endCursor);
    let added = false;
    if (!found) {
      // Not in project, add it
      const addResult = await octokit.graphql(`
        mutation($projectId:ID!, $contentId:ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
            item { id }
          }
        }
      `, {
        projectId: PROJECT_ID,
        contentId: nodeId
      });
      projectItemId = addResult.addProjectV2ItemById.item.id;
      added = true;
    }
    // Only set Status to Active for open PRs/issues, and to Done for closed unmerged PRs
    let statusMsg = '';
    if (type === 'PR' && prState === 'closed') {
      if (prMerged) {
        statusMsg = ', status=UNCHANGED (merged PR)';
      } else {
        await octokit.graphql(`
          mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId,
              itemId: $itemId,
              fieldId: $fieldId,
              value: { singleSelectOptionId: $optionId }
            }) { projectV2Item { id } }
          }
        `, {
          projectId: PROJECT_ID,
          itemId: projectItemId,
          fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA',
          optionId: STATUS_OPTIONS.done
        });
        statusMsg = ', status=Done (closed unmerged PR)';
      }
    } else {
      await octokit.graphql(`
        mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $optionId:String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: { singleSelectOptionId: $optionId }
          }) { projectV2Item { id } }
        }
      `, {
        projectId: PROJECT_ID,
        itemId: projectItemId,
        fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA',
        optionId: STATUS_OPTIONS.active
      });
      statusMsg = ', status=Active';
    }
    // Get Sprint field iterations
    // Use cachedCurrentSprintId for sprint assignment
    let sprintMsg = '';
    if (sprintField && sprintField.configuration) {
      await ensureCurrentSprintExists(sprintField);
      const iterations = sprintField.configuration.iterations;
      const currentSprintId = cachedCurrentSprintId;
      const currentSprint = iterations.find(i => i.id === currentSprintId);
      if (currentSprintId && currentSprint) {
        await octokit.graphql(`
          mutation($projectId:ID!, $itemId:ID!, $fieldId:ID!, $iterationId:String!) {
            updateProjectV2ItemFieldValue(input: {
              projectId: $projectId,
              itemId: $itemId,
              fieldId: $fieldId,
              value: { iterationId: $iterationId }
            }) { projectV2Item { id } }
          }
        `, {
          projectId: PROJECT_ID,
          itemId: projectItemId,
          fieldId: sprintField.id,
          iterationId: currentSprintId
        });
        sprintMsg = `, sprint='${currentSprint.title}'`;
      } else {
        sprintMsg = ', sprint=NOT FOUND (check sprint setup in project!)';
      }
    } else {
      sprintMsg = ', sprint=NOT FOUND (no sprint field)';
    }
    const action = added ? 'added to' : 'updated in';
    if (VERBOSE) {
      console.log(`[${repoName}] ${type} #${number}: ${action} project${statusMsg}${sprintMsg}`);
    } else if (statusMsg.includes('Active') || statusMsg.includes('Done')) {
      console.log(`[${repoName}] ${type} #${number}: ${action} project${statusMsg}${sprintMsg}`);
    }
  } catch (err) {
    console.error(`${logPrefix}[${repoName}] Error adding/updating ${type} #${number} in project:`, err.message);
    globalErrors.push(`Error adding/updating ${type} #${number} in project: ${err.message}`);
  }
}

async function assignPRsInRepo(repo, sprintField) {
  const [owner, name] = repo.split("/");
  let page = 1;
  let found = 0;
  let summary = { assigned: 0, project: 0, issues: 0 };
  const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  while (true) {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo: name,
      state: "all",
      per_page: 50,
      page
    });
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (
        pr.user && pr.user.login === GITHUB_AUTHOR &&
        (
          pr.state === "open" ||
          (pr.state === "closed" && pr.merged_at && new Date(pr.merged_at) >= sinceDate)
        )
      ) {
        // Always (re)assign to GITHUB_AUTHOR for consistency
        await octokit.issues.addAssignees({
          owner,
          repo: name,
          issue_number: pr.number,
          assignees: [GITHUB_AUTHOR]
        });
        summary.assigned++;
        // Add PR to GitHub Projects v2 and set Status to Active
        try {
          const prDetails = await octokit.pulls.get({ owner, repo: name, pull_number: pr.number });
          const prNodeId = prDetails.data.node_id;
          await addItemToProjectAndSetStatus(prNodeId, 'PR', pr.number, sprintField, '  ', `${owner}/${name}`, pr.state, pr.merged_at !== null);
          summary.project++;
        } catch (err) {
          console.error(`  [${owner}/${name}] Error preparing PR #${pr.number} for project:`, err.message);
          globalErrors.push(`Error preparing PR #${pr.number} for project: ${err.message}`);
        }
        // Fetch linked issues for this PR (only those in the same repository and in the development box)
        const { data: timeline } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline', {
          owner,
          repo: name,
          issue_number: pr.number,
          mediaType: { previews: ['mockingbird'] }
        });
        // Only consider cross-referenced events where the linked issue is in the same repo, is not a PR, and is referenced from the PR body (not a comment)
        const linkedIssues = timeline.filter(event =>
          event.event === 'cross-referenced' &&
          event.source &&
          event.source.issue &&
          event.source.issue.pull_request === undefined &&
          !event.source.comment &&
          event.source.issue.repository &&
          event.source.issue.repository.full_name === `${owner}/${name}`
        );
        for (const event of linkedIssues) {
          const issueNum = event.source.issue.number;
          await octokit.issues.addAssignees({
            owner,
            repo: name,
            issue_number: issueNum,
            assignees: [GITHUB_AUTHOR]
          });
          summary.issues++;
          // Add linked issue to GitHub Projects v2 and set Status to Active
          try {
            const issueDetails = await octokit.issues.get({ owner, repo: name, issue_number: issueNum });
            const issueNodeId = issueDetails.data.node_id;
            await addItemToProjectAndSetStatus(issueNodeId, 'issue', issueNum, sprintField, '    ', `${owner}/${name}`);
          } catch (err) {
            console.error(`    [${owner}/${name}] Error preparing issue #${issueNum} for project:`, err.message);
            globalErrors.push(`Error preparing issue #${issueNum} for project: ${err.message}`);
          }
        }
      }
    }
    page++;
  }
  if (summary.assigned === 0) {
    const msg = `[${owner}/${name}] No matching PRs by ${GITHUB_AUTHOR} found.`;
    console.log(msg);
    globalSummary.push(msg);
  } else {
    const msg = `[${owner}/${name}] Summary: PRs assigned: ${summary.assigned}, PRs added/updated in project: ${summary.project}, linked issues assigned: ${summary.issues}`;
    console.log(msg);
    globalSummary.push(msg);
  }
}

// Function to process and log globalErrors and globalSummary
/**
 * Logs diagnostic information about errors and summary details.
 *
 * `globalErrors` is an array of strings, where each string represents an error message.
 * Example: ["Error fetching PRs from repo1", "Failed to assign PR in repo2"]
 *
 * `globalSummary` is an array of strings, where each string summarizes actions taken for a repository.
 * Example: ["[repo1] Summary: PRs assigned: 2, PRs added/updated in project: 1, linked issues assigned: 0"]
 */
function logDiagnostics() {
  if (globalErrors.length > 0) {
    console.error("\n=== Errors ===");
    globalErrors.forEach((error, index) => {
      console.error(`${index + 1}. ${error}`);
    });
  } else {
    console.log("\nNo errors encountered.");
  }
  if (globalSummary.length > 0) {
    console.log("\n=== Summary ===");
    globalSummary.forEach((summary, index) => {
      console.log(`${index + 1}. ${summary}`);
    });
  } else {
    console.log("\nNo summary information available.");
  }
}

(async () => {
  // Remove unused isPRContext variable and related comments
  // Fetch project fields to get sprintField
  let sprintField = null;
  try {
    console.log('Fetching project fields for sprintField...');
    const projectFields = await octokit.graphql(`
      query($projectId:ID!){
        node(id:$projectId){
          ... on ProjectV2 {
            fields(first:20){
              nodes {
                ... on ProjectV2FieldCommon {
                  id
                  name
                  dataType
                }
                ... on ProjectV2IterationField {
                  configuration {
                    ... on ProjectV2IterationFieldConfiguration {
                      iterations { id title startDate duration }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, { projectId: PROJECT_ID });
    // Clean output: only print summary of fields
    const fields = projectFields.node.fields.nodes;
    if (VERBOSE) {
      console.log('Project fields:', fields.map(f => ({ id: f.id, name: f.name, dataType: f.dataType })));
    }
    sprintField = fields.find(f => f.name && f.name.toLowerCase().includes('sprint') && f.dataType === 'ITERATION');
    if (!sprintField) {
      console.error('No sprint field found in project fields!');
    } else if (sprintField && typeof sprintField.configuration === 'string') {
      sprintField.configuration = JSON.parse(sprintField.configuration);
    }
    await ensureCurrentSprintExists(sprintField);
  } catch (e) {
    const errMsg = 'Error fetching/ensuring sprints: ' + e.message;
    globalErrors.push(errMsg);
    console.error(errMsg);
    if (e.errors) {
      for (const err of e.errors) {
        globalErrors.push('GraphQL error: ' + JSON.stringify(err));
        console.error('GraphQL error:', err);
      }
    }
    if (e.response) {
      globalErrors.push('GraphQL response: ' + JSON.stringify(e.response, null, 2));
      console.error('GraphQL response:', JSON.stringify(e.response, null, 2));
    }
  }
  for (const repo of repos) {
    try {
      const fullRepo = repo.includes("/") ? repo : `bcgov/${repo}`;
      await assignPRsInRepo(fullRepo, sprintField);
    } catch (e) {
      const errMsg = `Error processing ${repo}: ${e.message}`;
      globalErrors.push(errMsg);
      console.error(errMsg);
    }
  }
  // Log diagnostics at the end
  logDiagnostics();
})();
