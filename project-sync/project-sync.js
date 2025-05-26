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

// Sprint field configuration
const SPRINT_FIELD_ID = 'PVTSSF_lADOAA37OM4AFuzgzgDTYuB'; // Replace with your actual Sprint fieldId

// Helper: Get current sprint optionId
async function getCurrentSprintOptionId() {
  // Fetch project fields and options
  const res = await octokit.graphql(`
    query($projectId:ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }
  `, { projectId: PROJECT_ID });
  const sprintField = res.node.fields.nodes.find(f => f.id === SPRINT_FIELD_ID);
  if (!sprintField) return null;
  // Find the option with 'current' or similar in the name (customize as needed)
  const current = sprintField.options.find(opt => /current/i.test(opt.name));
  return current ? current.id : null;
}

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
async function addOrUpdateProjectItem({ nodeId, type, number, repoName, statusOption, sprintField, diagnostics }) {
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
    // If moving to Active or Done, assign to current Sprint
    if (statusOption === STATUS_OPTIONS.active || statusOption === STATUS_OPTIONS.done) {
      let sprintOptionId = sprintField;
      if (!sprintOptionId) {
        sprintOptionId = await getCurrentSprintOptionId();
      }
      if (sprintOptionId) {
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
          fieldId: SPRINT_FIELD_ID,
          optionId: sprintOptionId
        });
      }
    }
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

  // 2. Add all open PRs in managed repos to Active
  page = 1;
  while (true) {
    const { data: prs } = await octokit.pulls.list({ state: 'open', per_page: 50, page });
    if (!prs.length) break;
    for (const pr of prs) {
      const repoFullName = getRepoFullName(pr);
      if (!managedRepos.includes(repoFullName)) continue;
      itemsToProcess.push({
        nodeId: pr.node_id,
        type: 'pr',
        number: pr.number,
        repoName: repoFullName,
        statusOption: STATUS_OPTIONS.active,
        sprintField: null,
        diagnostics
      });
    }
    page++;
  }

  // 3. Add all issues/PRs in managed repos with 'In Progress' or similar to Active
  const inProgressKeywords = ['in progress', 'doing', 'wip'];
  for (const repoFullName of managedRepos) {
    let endCursor = null;
    while (true) {
      const { data: issues } = await octokit.issues.listForRepo({
        owner: 'bcgov',
        repo: repoFullName.split('/')[1],
        state: 'all',
        labels: 'in progress',
        per_page: 100,
        page: 1,
        after: endCursor
      });
      if (!issues.length) break;
      for (const issue of issues) {
        if (issue.pull_request) continue;
        itemsToProcess.push({
          nodeId: issue.node_id,
          type: 'issue',
          number: issue.number,
          repoName: repoFullName,
          statusOption: STATUS_OPTIONS.active,
          sprintField: null,
          diagnostics
        });
      }
      endCursor = issues.length < 100 ? null : issues[issues.length - 1].cursor;
      if (!endCursor) break;
    }
  }

  // Deduplicate and process all items in parallel
  const uniqueItems = dedupeItems(itemsToProcess);
  await Promise.allSettled(uniqueItems.map(item => addOrUpdateProjectItem(item)));

  // Log diagnostics at the end
  logDiagnostics(diagnostics);
})();
