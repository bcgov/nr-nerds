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
const VERBOSE = process.argv.includes('--verbose');
// REMINDER: Consider TypeScript and more unit tests in future for maintainability and safety.

class DiagnosticsContext {
  constructor() {
    this.errors = [];
    this.summary = [];
  }
}

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

// === PROJECT ITEM CACHE ===
let projectItemCache = {};
async function buildProjectItemCache() {
  projectItemCache = {};
  let endCursor = null;
  do {
    const res = await octokit.graphql(`
      query($projectId:ID!, $after:String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              nodes {
                id
                content { ... on Issue { id } ... on PullRequest { id } }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      field { ... on ProjectV2FieldCommon { id name } }
                      optionId
                    }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `, { projectId: PROJECT_ID, after: endCursor });
    const items = res.node.items.nodes;
    for (const item of items) {
      if (item.content && item.content.id) {
        projectItemCache[item.content.id] = {
          projectItemId: item.id,
          fieldValues: item.fieldValues.nodes
        };
      }
    }
    endCursor = res.node.items.pageInfo.endCursor;
  } while (endCursor);
}

// Helper to check if a nodeId is in the project (using cache)
function getProjectItemFromCache(nodeId) {
  return projectItemCache[nodeId] || null;
}

// Helper to add an item (PR or issue) to project and set status and sprint
async function addItemToProjectAndSetStatus(nodeId, type, number, sprintField, logPrefix = '', repoName = '', prState = null, prMerged = false, diagnostics, isLinkedIssue = false, statusFieldOptions = null) {
  // Only process if repoName starts with 'bcgov/'
  if (!repoName.startsWith('bcgov/')) {
    if (VERBOSE) {
      console.log(`[${repoName}] ${type} #${number}: skipped (not in bcgov org)`);
    }
    return { added: false, updated: false, skipped: true };
  }
  try {
    let projectItemId = null;
    let found = false;
    const cacheEntry = getProjectItemFromCache(nodeId);
    let currentStatusOptionId = null;
    let currentSprintId = null;
    let statusChanged = false;
    let sprintChanged = false;
    if (cacheEntry) {
      projectItemId = cacheEntry.projectItemId;
      found = true;
      if (cacheEntry.fieldValues) {
        for (const fv of cacheEntry.fieldValues) {
          if (fv.field && fv.field.name && fv.field.name.toLowerCase() === 'status') {
            currentStatusOptionId = fv.optionId;
          }
          if (fv.field && fv.field.name && fv.field.name.toLowerCase().includes('sprint') && fv.iterationId) {
            currentSprintId = fv.iterationId;
          }
        }
      }
    }
    let added = false;
    if (!found) {
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
      projectItemCache[nodeId] = { projectItemId, fieldValues: [] };
    }
    let statusMsg = '';
    if (!statusFieldOptions) throw new Error('Status field options not provided');
    let desiredStatus = null;
    if (type === 'PR' && prState === 'closed') {
      if (prMerged) {
        statusMsg = ', status=UNCHANGED (merged PR)';
      } else {
        desiredStatus = statusFieldOptions.done;
        if (currentStatusOptionId !== desiredStatus) {
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
            fieldId: statusFieldOptions.fieldId,
            optionId: desiredStatus
          });
          statusMsg = ', status=Done (closed unmerged PR)';
          statusChanged = true;
          if (projectItemCache[nodeId]) {
            let fv = projectItemCache[nodeId].fieldValues;
            let found = false;
            for (const v of fv) {
              if (v.field && v.field.name && v.field.name.toLowerCase() === 'status') {
                v.optionId = desiredStatus;
                found = true;
                break;
              }
            }
            if (!found) {
              fv.push({ field: { name: 'Status' }, optionId: desiredStatus });
            }
          }
        } else {
          statusMsg = ', status=Done (already set)';
        }
      }
    } else if (type === 'issue' && prState === 'closed') {
      desiredStatus = statusFieldOptions.done;
      if (currentStatusOptionId !== desiredStatus) {
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
          fieldId: statusFieldOptions.fieldId,
          optionId: desiredStatus
        });
        statusMsg = ', status=Done (closed/linked issue)';
        statusChanged = true;
      } else {
        statusMsg = ', status=Done (already set)';
      }
    } else {
      desiredStatus = statusFieldOptions.active;
      if (currentStatusOptionId !== desiredStatus) {
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
          fieldId: statusFieldOptions.fieldId,
          optionId: desiredStatus
        });
        statusMsg = ', status=Active';
        statusChanged = true;
      } else {
        statusMsg = ', status=Active (already set)';
      }
    }
    let sprintMsg = '';
    if (sprintField && sprintField.configuration) {
      await ensureCurrentSprintExists(sprintField);
      const iterations = sprintField.configuration.iterations;
      const currentSprintId = cachedCurrentSprintId;
      const currentSprint = iterations.find(i => i.id === currentSprintId);
      if (currentSprintId && currentSprint) {
        let sprintAlreadySetToCurrent = false;
        if (cacheEntry && cacheEntry.fieldValues) {
          for (const fv of cacheEntry.fieldValues) {
            if (
              fv.field &&
              fv.field.name &&
              fv.field.name.toLowerCase().includes('sprint') &&
              fv.iterationId === currentSprintId
            ) {
              sprintAlreadySetToCurrent = true;
              break;
            }
          }
        }
        if (!sprintAlreadySetToCurrent) {
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
          sprintChanged = true;
          if (projectItemCache[nodeId]) {
            let fv = projectItemCache[nodeId].fieldValues;
            let found = false;
            for (const v of fv) {
              if (v.field && v.field.name && v.field.name.toLowerCase().includes('sprint')) {
                v.iterationId = currentSprintId;
                found = true;
                break;
              }
            }
            if (!found) {
              fv.push({ field: { name: 'Sprint' }, iterationId: currentSprintId });
            }
          }
        } else {
          sprintMsg = `, sprint='${currentSprint.title}' (already set)`;
        }
      } else {
        sprintMsg = ', sprint=NOT FOUND (check sprint setup in project!)';
      }
    } else {
      sprintMsg = ', sprint=NOT FOUND (no sprint field)';
    }
    let action;
    let explanation = '';
    if (added) {
      action = 'added to';
    } else if (!statusChanged && !sprintChanged) {
      action = 'already up to date in';
      if (statusMsg.includes('(already set)') && sprintMsg.includes('(already set)')) {
        explanation = ' (status and sprint already set)';
      } else if (statusMsg.includes('(already set)')) {
        explanation = ' (status already set)';
      } else if (sprintMsg.includes('(already set)')) {
        explanation = ' (sprint already set)';
      }
    } else {
      action = 'updated in';
      let updates = [];
      if (statusChanged) updates.push('status');
      if (sprintChanged) updates.push('sprint');
      if (updates.length > 0) explanation = ` (updated: ${updates.join(', ')})`;
    }
    if (VERBOSE) {
      console.log(`[${repoName}] ${type} #${number}: ${action} project${statusMsg}${sprintMsg}${explanation}`);
    } else if (action !== 'already up to date in') {
      console.log(`[${repoName}] ${type} #${number}: ${action} project${statusMsg}${sprintMsg}${explanation}`);
    }
    // Return a result object for summary tracking
    return { added, updated: statusChanged || sprintChanged, skipped: (!added && !statusChanged && !sprintChanged) };
  } catch (err) {
    console.error(`${logPrefix}[${repoName}] Error adding/updating ${type} #${number} in project:`, err.message);
    diagnostics.errors.push(`Error adding/updating ${type} #${number} in project: ${err.message}`);
    return { added: false, updated: false, skipped: false, error: true };
  }
}

// Helper to add assigned issues to project board in 'New' column if not already set
async function addAssignedIssuesToProject(sprintField, diagnostics, statusFieldOptions) {
  let processed = 0, added = 0, updated = 0, skipped = 0;
  try {
    const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    for (const repoEntry of reposConfig) {
      let repo = repoEntry.name;
      let autoAddMode = repoEntry.auto_add;
      let owner, name;
      let repoFull = repo.includes("/") ? repo : `bcgov/${repo}`;
      [owner, name] = repoFull.split("/");
      if (!owner || !name) {
        diagnostics.errors.push(`Invalid repo format in repos.yml: '${repo}'. Expected 'owner/repo' or repo name. Skipping.`);
        if (VERBOSE) {
          console.error(`Invalid repo format in repos.yml: '${repo}'. Skipping.`);
        }
        continue;
      }
      let page = 1;
      while (true) {
        let issuesQuery = {
          owner,
          repo: name,
          state: "open",
          per_page: 50,
          page
        };
        if (autoAddMode === 'assigned') {
          issuesQuery.assignee = GITHUB_AUTHOR;
        }
        const { data: issues } = await octokit.issues.listForRepo(issuesQuery);
        if (issues.length === 0) break;
        for (const issue of issues) {
          if (issue.pull_request) continue;
          processed++;
          const sinceRelevant = new Date(issue.updated_at || issue.created_at) >= sinceDate;
          const isAssigned = (issue.assignees || []).length > 0;
          if (!isAssigned && !sinceRelevant) { skipped++; continue; }
          try {
            const result = await addItemToProjectAndSetStatus(issue.node_id, 'issue', issue.number, sprintField, '', `${owner}/${name}`, undefined, undefined, diagnostics, false, statusFieldOptions);
            if (result.added) added++;
            else if (result.updated) updated++;
            else skipped++;
          } catch (err) {
            diagnostics.errors.push(`[${String(owner)}/${String(name)}] Error processing assigned issue #${String(issue.number)}: ${err.message}`);
            if (VERBOSE) {
              console.error('[%s/%s] Error processing assigned issue #%s:', String(owner), String(name), String(issue.number), err);
            }
          }
        }
        page++;
      }
    }
    diagnostics.summary.push(`[addAssignedIssuesToProject] Processed: ${processed}, Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
  } catch (e) {
    diagnostics.errors.push(`Error in addAssignedIssuesToProject: ${e.message}`);
    if (VERBOSE) {
      console.error('Error in addAssignedIssuesToProject:', e);
    }
  }
}

// Add all issues assigned to the authenticated user, from any repo, to the project board
async function addAllAssignedIssuesToProject(sprintField, diagnostics, statusFieldOptions) {
  let page = 1;
  let processed = 0, added = 0, updated = 0, skipped = 0;
  const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  while (true) {
    const { data: issues } = await octokit.issues.listForAuthenticatedUser({
      filter: 'assigned',
      state: 'open',
      per_page: 50,
      page
    });
    if (issues.length === 0) break;
    for (const issue of issues) {
      if (issue.pull_request) continue;
      processed++;
      const updatedAt = new Date(issue.updated_at || issue.created_at);
      if (updatedAt < sinceDate) { skipped++; continue; }
      try {
        const owner = issue.repository.owner.login;
        const name = issue.repository.name;
        const result = await addItemToProjectAndSetStatus(issue.node_id, 'issue', issue.number, sprintField, '', `${owner}/${name}`, undefined, undefined, diagnostics, false, statusFieldOptions);
        if (result.added) added++;
        else if (result.updated) updated++;
        else skipped++;
      } catch (err) {
        diagnostics.errors.push(`[${String(issue.repository.owner.login)}/${String(issue.repository.name)}] Error processing assigned issue #${String(issue.number)}: ${err.message}`);
        if (VERBOSE) {
          console.error('[%s/%s] Error processing assigned issue #%s:', String(issue.repository.owner.login), String(issue.repository.name), String(issue.number), err);
        }
      }
    }
    page++;
  }
  diagnostics.summary.push(`[addAllAssignedIssuesToProject] Processed: ${processed}, Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
}

// Add all PRs created by the authenticated user, from any repo, to the project board
async function addAllAuthoredPRsToProject(sprintField, diagnostics, statusFieldOptions) {
  let after = null;
  let processed = 0, added = 0, updated = 0, skipped = 0;
  const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  while (true) {
    const prsResult = await octokit.graphql(`
      query($q: String!, $first: Int!, $after: String) {
        search(query: $q, type: ISSUE, first: $first, after: $after) {
          nodes {
            ... on PullRequest {
              number
              title
              updatedAt
              createdAt
              url
              state
              merged
              author { login }
              assignees(first: 10) { nodes { login } }
              repository { name owner { login } }
              id
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { q: `is:pr author:${GITHUB_AUTHOR} is:open`, first: 50, after });
    const prs = prsResult.search.nodes;
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (!pr) continue;
      processed++;
      const updatedAt = new Date(pr.updatedAt || pr.createdAt);
      if (updatedAt < sinceDate) { skipped++; continue; }
      try {
        const owner = pr.repository.owner.login;
        const name = pr.repository.name;
        const prNodeId = pr.id;
        const prState = pr.state.toLowerCase();
        const prMerged = pr.merged;
        const result = await addItemToProjectAndSetStatus(prNodeId, 'PR', pr.number, sprintField, '', `${owner}/${name}`, prState, prMerged, diagnostics, false, statusFieldOptions);
        if (result.added) added++;
        else if (result.updated) updated++;
        else skipped++;
      } catch (err) {
        diagnostics.errors.push(`[${pr.url}] Error processing globally authored PR #${pr.number}: ${err.message}`);
        if (VERBOSE) {
          console.error(`[${pr.url}] Error processing globally authored PR #${pr.number}:`, err);
        }
      }
    }
    if (!prsResult.search.pageInfo.hasNextPage) break;
    after = prsResult.search.pageInfo.endCursor;
  }
  diagnostics.summary.push(`[addAllAuthoredPRsToProject] Processed: ${processed}, Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
}

// Add all open PRs where the user is a commit author (not just PR author/assignee) to the project board.
async function addAllCommitterPRsToProject(sprintField, diagnostics, statusFieldOptions) {
  const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  let processed = 0, added = 0, updated = 0, skipped = 0;
  for (const repoEntry of reposConfig) {
    const repoFull = repoEntry.name.includes("/") ? repoEntry.name : `bcgov/${repoEntry.name}`;
    const [owner, name] = repoFull.split("/");
    let page = 1;
    while (true) {
      const { data: prs } = await octokit.pulls.list({
        owner,
        repo: name,
        state: "open",
        per_page: 50,
        page
      });
      if (prs.length === 0) break;
      for (const pr of prs) {
        processed++;
        const prUpdatedAt = new Date(pr.updated_at);
        if (prUpdatedAt < sinceDate) { skipped++; continue; }
        const isAuthor = pr.user && pr.user.login === GITHUB_AUTHOR;
        const isAssignee = (pr.assignees || []).some(a => a.login === GITHUB_AUTHOR);
        if (isAuthor || isAssignee) { skipped++; continue; }
        let commitPage = 1;
        let found = false;
        while (!found) {
          const { data: commits } = await octokit.pulls.listCommits({
            owner,
            repo: name,
            pull_number: pr.number,
            per_page: 100,
            page: commitPage
          });
          if (commits.length === 0) break;
          for (const commit of commits) {
            if (commit.author && commit.author.login === GITHUB_AUTHOR) {
              found = true;
              break;
            }
          }
          if (commits.length < 100) break;
          commitPage++;
        }
        if (found) {
          try {
            const prNodeId = pr.node_id;
            await addItemToProjectAndSetStatus(prNodeId, 'PR', pr.number, sprintField, '  ', `${owner}/${name}`, pr.state, pr.merged_at !== null, diagnostics, false, statusFieldOptions);
            added++;
            if (VERBOSE) {
              console.log(`[${owner}/${name}] PR #${pr.number}: added to project (commit author)`);
            }
          } catch (err) {
            diagnostics.errors.push(`[${owner}/${name}] Error processing PR #${pr.number} (commit author): ${err.message}`);
            if (VERBOSE) {
              console.error(`[${owner}/${name}] Error processing PR #${pr.number} (commit author):`, err);
            }
          }
        } else {
          skipped++;
        }
      }
      page++;
    }
  }
  diagnostics.summary.push(`[addAllCommitterPRsToProject] Processed: ${processed}, Added: ${added}, Skipped: ${skipped}`);
}

// For all PRs assigned to the user, handle linked issues, but skip PRs where user is only a reviewer.
async function handleLinkedIssuesForAssignedPRs(sprintField, diagnostics, statusFieldOptions) {
  let after = null;
  let processed = 0, added = 0, updated = 0, skipped = 0;
  const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  while (true) {
    const prsResult = await octokit.graphql(`
      query($q: String!, $first: Int!, $after: String) {
        search(query: $q, type: ISSUE, first: $first, after: $after) {
          nodes {
            ... on PullRequest {
              number
              title
              updatedAt
              createdAt
              url
              state
              merged
              author { login }
              assignees(first: 10) { nodes { login } }
              repository { name owner { login } }
              id
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { q: `is:pr assignee:${GITHUB_AUTHOR} is:open`, first: 50, after });
    const prs = prsResult.search.nodes;
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (!pr) continue;
      processed++;
      const updatedAt = new Date(pr.updatedAt || pr.createdAt);
      if (updatedAt < sinceDate) { skipped++; continue; }
      const owner = pr.repository.owner.login;
      const name = pr.repository.name;
      let prDetails;
      try {
        prDetails = await octokit.pulls.get({ owner, repo: name, pull_number: pr.number });
      } catch (err) {
        diagnostics.errors.push(`[${owner}/${name}] Error fetching PR #${pr.number} details: ${err.message}`);
        if (VERBOSE) console.error(`[${owner}/${name}] Error fetching PR #${pr.number} details:`, err);
        continue;
      }
      // Skip if user is only a reviewer (not author or assignee)
      const isAuthor = prDetails.data.user && prDetails.data.user.login === GITHUB_AUTHOR;
      const isAssignee = (prDetails.data.assignees || []).some(a => a.login === GITHUB_AUTHOR);
      if (!isAuthor && !isAssignee) { skipped++; continue; }
      // Fetch timeline for linked issues
      let timeline;
      try {
        const resp = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline', {
          owner,
          repo: name,
          issue_number: pr.number,
          mediaType: { previews: ['mockingbird'] }
        });
        timeline = resp.data;
      } catch (err) {
        diagnostics.errors.push(`[${owner}/${name}] Error fetching timeline for PR #${pr.number}: ${err.message}`);
        if (VERBOSE) console.error(`[${owner}/${name}] Error fetching timeline for PR #${pr.number}:`, err);
        continue;
      }
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
        try {
          await octokit.issues.addAssignees({
            owner,
            repo: name,
            issue_number: issueNum,
            assignees: [GITHUB_AUTHOR]
          });
          // Add linked issue to project and set status
          const issueDetails = await octokit.issues.get({ owner, repo: name, issue_number: issueNum });
          const issueNodeId = issueDetails.data.node_id;
          const result = await addItemToProjectAndSetStatus(issueNodeId, 'issue', issueNum, sprintField, '    ', `${owner}/${name}`, undefined, undefined, diagnostics, false, statusFieldOptions);
          if (result.added) added++;
          else if (result.updated) updated++;
          else skipped++;
        } catch (err) {
          diagnostics.errors.push(`[${owner}/${name}] Error handling linked issue #${issueNum} for PR #${pr.number}: ${err.message}`);
          if (VERBOSE) console.error(`[${owner}/${name}] Error handling linked issue #${issueNum} for PR #${pr.number}:`, err);
        }
      }
    }
    if (!prsResult.search.pageInfo.hasNextPage) break;
    after = prsResult.search.pageInfo.endCursor;
  }
  diagnostics.summary.push(`[handleLinkedIssuesForAssignedPRs] PRs processed: ${processed}, Linked issues added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
}

// Parse repos config to support per-repo auto_add mode
function getReposConfig(rawRepos) {
  return rawRepos.map(entry => {
    if (typeof entry === 'string') {
      return { name: entry, auto_add: 'all' };
    }
    // Only use object format for special cases (e.g., auto_add: assigned)
    return { name: entry.name, auto_add: entry.auto_add || 'all' };
  });
}
const reposConfig = getReposConfig(repos);

// Helper to fetch Status field and its option IDs
async function getStatusFieldOptions(projectId) {
  const result = await octokit.graphql(`
    query($projectId:ID!){
      node(id:$projectId){
        ... on ProjectV2 {
          fields(first:50){
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
  `, { projectId });
  const fields = result.node.fields.nodes;
  const statusField = fields.find(f => f.name && f.name.toLowerCase() === 'status');
  if (!statusField) throw new Error('No Status field found in project');
  const options = {};
  for (const opt of statusField.options) {
    if (opt.name.toLowerCase() === 'active') options.active = opt.id;
    if (opt.name.toLowerCase() === 'done') options.done = opt.id;
    if (opt.name.toLowerCase() === 'new') options.new = opt.id;
  }
  if (!options.active || !options.done || !options.new) {
    throw new Error('Could not find all required Status options (Active, Done, New)');
  }
  return { fieldId: statusField.id, ...options };
}

/**
 * Logs diagnostic information about errors and summary details.
 *
 * @param {DiagnosticsContext} diagnostics - The diagnostics context containing errors and summary arrays.
 *
 * `diagnostics.errors` is an array of strings, where each string represents an error message.
 * Example: ["Error fetching PRs from repo1", "Failed to assign PR in repo2"]
 *
 * `diagnostics.summary` is an array of strings, where each string summarizes actions taken for a repository.
 * Example: ["[repo1] Summary: PRs assigned: 2, PRs added/updated in project: 1, linked issues assigned: 0"]
 *
 * @returns {void} This function does not return a value.
 */
function logDiagnostics(diagnostics) {
  if (diagnostics.errors.length > 0) {
    console.error("\n=== Errors ===");
    diagnostics.errors.forEach((error, index) => {
      console.error(`${index + 1}. ${error}`);
    });
  } else {
    console.log("\nNo errors encountered.");
  }
  if (diagnostics.summary.length > 0) {
    console.log("\n=== Summary ===");
    diagnostics.summary.forEach((summary, index) => {
      console.log(`${index + 1}. ${summary}`);
    });
  } else {
    console.log("\nNo summary information available.");
  }
}

// Utility to sanitize GraphQL error responses before logging
function sanitizeGraphQLResponse(response) {
  // Deep clone to avoid mutating the original
  const clone = JSON.parse(JSON.stringify(response));
  // Redact common sensitive fields
  const redactKeys = ['token', 'access_token', 'authorization', 'email', 'login', 'node_id'];
  function redact(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(redact);
    } else if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (redactKeys.includes(key.toLowerCase())) {
          obj[key] = '[REDACTED]';
        } else {
          redact(obj[key]);
        }
      }
    }
  }
  redact(clone);
  return clone;
}

(async () => {
  // Fetch project fields to get sprintField and statusField
  let sprintField = null;
  let statusFieldOptions = null;
  const diagnostics = new DiagnosticsContext();
  try {
    if (VERBOSE) {
      console.log('Fetching project fields for sprintField and statusField...');
    }
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
    // Fetch status field options
    statusFieldOptions = await getStatusFieldOptions(PROJECT_ID);
  } catch (e) {
    const errMsg = 'Error fetching/ensuring sprints or status field: ' + e.message;
    diagnostics.errors.push(errMsg);
    console.error(errMsg);
    if (e.errors) {
      for (const err of e.errors) {
        diagnostics.errors.push('GraphQL error: ' + JSON.stringify(err));
        console.error('GraphQL error:', err);
      }
    }
    if (e.response) {
      const sanitizedResponse = sanitizeGraphQLResponse(e.response);
      diagnostics.errors.push('GraphQL response: ' + JSON.stringify(sanitizedResponse, null, 2));
      console.error('GraphQL response:', JSON.stringify(sanitizedResponse, null, 2));
    }
  }
  // Build the project item cache
  await buildProjectItemCache();
  // Add assigned issues to project board in 'New' column if not already set (per-repo config)
  await addAssignedIssuesToProject(sprintField, diagnostics, statusFieldOptions);
  // Add all globally assigned issues (from any repo) to the project board
  await addAllAssignedIssuesToProject(sprintField, diagnostics, statusFieldOptions);
  // Add all globally authored PRs (from any repo) to the project board
  await addAllAuthoredPRsToProject(sprintField, diagnostics, statusFieldOptions);
  // Add all open PRs where the user has committed code (commit author)
  await addAllCommitterPRsToProject(sprintField, diagnostics, statusFieldOptions);
  // Handle linked issues for all PRs assigned to the user (not just authored), but skip PRs where user is only a reviewer
  await handleLinkedIssuesForAssignedPRs(sprintField, diagnostics, statusFieldOptions);
  // Remove assignPRsInRepo calls (no longer needed)
  // for (const repo of repos) {
  //   const fullRepo = repo.includes("/") ? repo : `bcgov/${repo}`;
  //   try {
  //     await assignPRsInRepo(fullRepo, sprintField, diagnostics, statusFieldOptions);
  //   } catch (e) {
  //     const errMsg = `Error processing ${fullRepo}: ${e.message}`;
  //     diagnostics.errors.push(errMsg);
  //     console.error(errMsg);
  //   }
  // }
  // Log diagnostics at the end
  logDiagnostics(diagnostics);
})();

/**
 * For all PRs assigned to the user, handle linked issues, but skip PRs where user is only a reviewer.
 */
async function handleLinkedIssuesForAssignedPRs(sprintField, diagnostics, statusFieldOptions) {
  let after = null;
  let processed = 0, added = 0, updated = 0, skipped = 0;
  const sinceDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
  while (true) {
    const prsResult = await octokit.graphql(`
      query($q: String!, $first: Int!, $after: String) {
        search(query: $q, type: ISSUE, first: $first, after: $after) {
          nodes {
            ... on PullRequest {
              number
              title
              updatedAt
              createdAt
              url
              state
              merged
              author { login }
              assignees(first: 10) { nodes { login } }
              repository { name owner { login } }
              id
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { q: `is:pr assignee:${GITHUB_AUTHOR} is:open`, first: 50, after });
    const prs = prsResult.search.nodes;
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (!pr) continue;
      processed++;
      const updatedAt = new Date(pr.updatedAt || pr.createdAt);
      if (updatedAt < sinceDate) { skipped++; continue; }
      const owner = pr.repository.owner.login;
      const name = pr.repository.name;
      let prDetails;
      try {
        prDetails = await octokit.pulls.get({ owner, repo: name, pull_number: pr.number });
      } catch (err) {
        diagnostics.errors.push(`[${owner}/${name}] Error fetching PR #${pr.number} details: ${err.message}`);
        if (VERBOSE) console.error(`[${owner}/${name}] Error fetching PR #${pr.number} details:`, err);
        continue;
      }
      // Skip if user is only a reviewer (not author or assignee)
      const isAuthor = prDetails.data.user && prDetails.data.user.login === GITHUB_AUTHOR;
      const isAssignee = (prDetails.data.assignees || []).some(a => a.login === GITHUB_AUTHOR);
      if (!isAuthor && !isAssignee) { skipped++; continue; }
      // Fetch timeline for linked issues
      let timeline;
      try {
        const resp = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline', {
          owner,
          repo: name,
          issue_number: pr.number,
          mediaType: { previews: ['mockingbird'] }
        });
        timeline = resp.data;
      } catch (err) {
        diagnostics.errors.push(`[${owner}/${name}] Error fetching timeline for PR #${pr.number}: ${err.message}`);
        if (VERBOSE) console.error(`[${owner}/${name}] Error fetching timeline for PR #${pr.number}:`, err);
        continue;
      }
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
        try {
          await octokit.issues.addAssignees({
            owner,
            repo: name,
            issue_number: issueNum,
            assignees: [GITHUB_AUTHOR]
          });
          // Add linked issue to project and set status
          const issueDetails = await octokit.issues.get({ owner, repo: name, issue_number: issueNum });
          const issueNodeId = issueDetails.data.node_id;
          const result = await addItemToProjectAndSetStatus(issueNodeId, 'issue', issueNum, sprintField, '    ', `${owner}/${name}`, undefined, undefined, diagnostics, false, statusFieldOptions);
          if (result.added) added++;
          else if (result.updated) updated++;
          else skipped++;
        } catch (err) {
          diagnostics.errors.push(`[${owner}/${name}] Error handling linked issue #${issueNum} for PR #${pr.number}: ${err.message}`);
          if (VERBOSE) console.error(`[${owner}/${name}] Error handling linked issue #${issueNum} for PR #${pr.number}:`, err);
        }
      }
    }
    if (!prsResult.search.pageInfo.hasNextPage) break;
    after = prsResult.search.pageInfo.endCursor;
  }
  diagnostics.summary.push(`[handleLinkedIssuesForAssignedPRs] PRs processed: ${processed}, Linked issues added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
}
