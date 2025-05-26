// Script to manage GitHub Projects v2: assign issues/PRs to project columns based on rules
const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const yaml = require("js-yaml");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_AUTHOR = process.env.GITHUB_AUTHOR || "DerekRoberts";
const octokit = new Octokit({ auth: GH_TOKEN });

const PROJECT_ID = 'PVT_kwDOAA37OM4AFuzg';
const repos = yaml.load(fs.readFileSync("project-sync/repos.yml")).repos;

// --- CONFIGURATION ---
const STATUS_OPTIONS = {
  new: 'f8e1e5a4',      // optionId for 'New' column
  active: 'c66ba2dd',   // optionId for 'Active' column
  done: '46321e20'      // optionId for 'Done' column
};

// --- Helper: Get managed repos from repos.yml ---
function getManagedRepos() {
  return repos.map(r => (typeof r === 'string' ? `bcgov/${r}` : (r.name && r.name.includes('/') ? r.name : `bcgov/${r.name}`)));
}

// --- Helper: Parse repo full name from URL or object ---
function getRepoFullName(issueOrPr) {
  if (issueOrPr.repository && issueOrPr.repository.full_name) return issueOrPr.repository.full_name;
  if (issueOrPr.repository_url) return issueOrPr.repository_url.split('/').slice(-2).join('/');
  return '';
}

// --- Helper: Deduplicate items by nodeId ---
function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.nodeId)) map.set(item.nodeId, item);
  }
  return Array.from(map.values());
}

// --- Add or update item in project ---
async function addOrUpdateProjectItem({ nodeId, type, number, repoName, statusOption, diagnostics }) {
  try {
    // Find or add item to project
    let projectItemId = null;
    let endCursor = null;
    let found = false;
    do {
      const res = await octokit.graphql(`
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
      `, { projectId: PROJECT_ID, after: endCursor });
      const items = res.node.items.nodes;
      const match = items.find(item => item.content && item.content.id === nodeId);
      if (match) {
        projectItemId = match.id;
        found = true;
        break;
      }
      endCursor = res.node.items.pageInfo.endCursor;
    } while (endCursor);
    if (!found) {
      const addResult = await octokit.graphql(`
        mutation($projectId:ID!, $contentId:ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
            item { id }
          }
        }
      `, { projectId: PROJECT_ID, contentId: nodeId });
      projectItemId = addResult.addProjectV2ItemById.item.id;
    }
    // Set status
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
      fieldId: 'PVTSSF_lADOAA37OM4AFuzgzgDTYuA', // Status fieldId
      optionId: statusOption
    });
  } catch (err) {
    diagnostics.errors.push(`Error adding/updating ${type} #${number} in project: ${err.message}`);
  }
}

// --- Main logic ---
(async () => {
  const diagnostics = new DiagnosticsContext();
  const managedRepos = getManagedRepos();
  const itemsToProcess = [];

  // 1. Add all issues assigned to me in any bcgov repo to New
  let page = 1;
  while (true) {
    const { data: issues } = await octokit.issues.listForAuthenticatedUser({ filter: 'assigned', state: 'open', per_page: 50, page });
    if (!issues.length) break;
    for (const issue of issues) {
      if (issue.pull_request) continue;
      const repoFullName = getRepoFullName(issue);
      if (!repoFullName.startsWith('bcgov/')) continue;
      itemsToProcess.push({
        nodeId: issue.node_id,
        type: 'issue',
        number: issue.number,
        repoName: repoFullName,
        statusOption: STATUS_OPTIONS.new,
        sprintField: null,
        diagnostics
      });
    }
    page++;
  }

  // 2. Add all PRs authored by me in any bcgov repo to Active, and handle linked issues
  page = 1;
  while (true) {
    const prsResult = await octokit.search.issuesAndPullRequests({
      q: `is:pr is:open user:bcgov author:${GITHUB_AUTHOR}`,
      per_page: 50,
      page
    });
    if (!prsResult.data.items.length) break;
    for (const pr of prsResult.data.items) {
      const repoFullName = getRepoFullName(pr);
      itemsToProcess.push({
        nodeId: pr.node_id,
        type: 'PR',
        number: pr.number,
        repoName: repoFullName,
        statusOption: STATUS_OPTIONS.active,
        sprintField: null,
        diagnostics
      });
      // Linked issues: fetch timeline for cross-referenced issues
      const [owner, repo] = repoFullName.split('/');
      const { data: timeline } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline', {
        owner,
        repo,
        issue_number: pr.number,
        mediaType: { previews: ['mockingbird'] }
      });
      const linkedIssues = timeline.filter(event =>
        event.event === 'cross-referenced' &&
        event.source &&
        event.source.issue &&
        event.source.issue.pull_request === undefined &&
        !event.source.comment &&
        event.source.issue.repository &&
        event.source.issue.repository.full_name === repoFullName
      );
      for (const event of linkedIssues) {
        const issueNum = event.source.issue.number;
        const issueDetails = await octokit.issues.get({ owner, repo, issue_number: issueNum });
        itemsToProcess.push({
          nodeId: issueDetails.data.node_id,
          type: 'issue',
          number: issueNum,
          repoName: repoFullName,
          statusOption: STATUS_OPTIONS.active,
          sprintField: null,
          diagnostics
        });
      }
    }
    page++;
  }

  // 3. For managed repos, add any new issues to New
  for (const repoFullName of managedRepos) {
    const [owner, repo] = repoFullName.split('/');
    let page = 1;
    while (true) {
      const { data: issues } = await octokit.issues.listForRepo({ owner, repo, state: 'open', per_page: 50, page });
      if (!issues.length) break;
      for (const issue of issues) {
        if (issue.pull_request) continue;
        itemsToProcess.push({
          nodeId: issue.node_id,
          type: 'issue',
          number: issue.number,
          repoName: repoFullName,
          statusOption: STATUS_OPTIONS.new,
          sprintField: null,
          diagnostics
        });
      }
      page++;
    }
  }

  // Deduplicate and process all items in parallel
  const uniqueItems = dedupeItems(itemsToProcess);
  await Promise.allSettled(uniqueItems.map(item => addOrUpdateProjectItem(item)));

  // Log diagnostics at the end
  logDiagnostics(diagnostics);
})();
//# sourceMappingURL=index.js.map
