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
async function addItemToProjectAndSetStatus(nodeId, type, number, sprintField, logPrefix = '', repoName = '', prState = null, prMerged = false, diagnostics, isRepoYml = false, isAssignedToUser = false, isLinkedToPR = false, statusFieldOptions = null) {
  // Only process if repoName starts with 'bcgov/'
  if (!repoName.startsWith('bcgov/')) {
    if (VERBOSE) {
      console.log(`[${repoName}] ${type} #${number}: skipped (not in bcgov org)`);
    }
    return { added: false, updated: false, skipped: true };
  }
  // Check if repo is archived
  const [owner, repo] = repoName.split('/');
  try {
    const repoInfo = await octokit.repos.get({ owner, repo });
    if (repoInfo.data.archived) {
      if (VERBOSE) {
        console.log(`[${repoName}] ${type} #${number}: skipped (archived repo)`);
      }
      return { added: false, updated: false, skipped: true };
    }
  } catch (err) {
    diagnostics.errors.push(`[${repoName}] Error checking if repo is archived: ${err.message}`);
    if (VERBOSE) {
      console.error(`[${repoName}] Error checking if repo is archived:`, err);
    }
    // Fail open: continue processing if we can't check
  }
  // === NEW LOGIC FOR ISSUES ===
  if (type === 'issue') {
    if (!isRepoYml && !isAssignedToUser && !isLinkedToPR) {
      if (VERBOSE) {
        console.log(`[${repoName}] issue #${number}: skipped (not in repo.yml, not assigned to user, not linked to PR)`);
      }
      return { added: false, updated: false, skipped: true };
    }
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
    // === LOGIC FOR PRs ===
    if (type === 'PR' && prState === 'closed') {
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
        statusMsg = ', status=Done (closed PR)';
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
    } else if (type === 'issue') {
      // === LOGIC FOR ISSUES ===
      if (isLinkedToPR) {
        desiredStatus = statusFieldOptions.active;
      } else if (isRepoYml || isAssignedToUser) {
        desiredStatus = statusFieldOptions.new;
      }
      if (desiredStatus && currentStatusOptionId !== desiredStatus) {
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
        statusMsg = `, status=${isLinkedToPR ? 'Active (linked to PR)' : 'New'}`;
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
      } else if (desiredStatus) {
        statusMsg = `, status=${isLinkedToPR ? 'Active (already set)' : 'New (already set)'}`;
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
    // Use current date for sinceDate
    const now = new Date();
    const sinceDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
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
          const updatedAt = new Date(issue.updated_at || issue.created_at);
          if (updatedAt < sinceDate) { skipped++; continue; }
          try {
            // Issues from repo.yml: isRepoYml=true, isAssignedToUser if assigned, isLinkedToPR=false
            const isRepoYml = true;
            const isAssignedToUser = (issue.assignees || []).some(a => a.login === GITHUB_AUTHOR);
            const isLinkedToPR = false;
            const result = await addItemToProjectAndSetStatus(
              issue.node_id, 'issue', issue.number, sprintField, '', `${owner}/${name}`, undefined, undefined, diagnostics,
              isRepoYml, isAssignedToUser, isLinkedToPR, statusFieldOptions
            );
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
  } catch (err) {
    console.error('Error in addAssignedIssuesToProject:', err);
    diagnostics.errors.push('Error in addAssignedIssuesToProject: ' + err.message);
  }
  return { processed, added, updated, skipped };
}

// Main processing function
async function processProjectBoard(diagnostics) {
  // Build project item cache
  await buildProjectItemCache();
  // Process each repo in the config
  for (const repoEntry of repos) {
    const repoName = repoEntry.name;
    const autoAdd = repoEntry.auto_add;
    if (VERBOSE) {
      console.log(`\n=== Processing repo: ${repoName} (auto_add=${autoAdd}) ===`);
    } else {
      process.stdout.write(`\nProcessing repo: ${repoName}... `);
    }
    // Skip repos not starting with 'bcgov/'
    if (!repoName.startsWith('bcgov/')) {
      if (VERBOSE) {
        console.log(`Skipped (not in bcgov org)`);
      }
      continue;
    }
    // Check if repo is archived
    const [owner, repo] = repoName.split('/');
    try {
      const repoInfo = await octokit.repos.get({ owner, repo });
      if (repoInfo.data.archived) {
        if (VERBOSE) {
          console.log(`Skipped (archived repo)`);
        }
        continue;
      }
    } catch (err) {
      diagnostics.errors.push(`[${repoName}] Error checking if repo is archived: ${err.message}`);
      if (VERBOSE) {
        console.error(`[${repoName}] Error checking if repo is archived:`, err);
      }
      // Fail open: continue processing if we can't check
    }
    // Determine if repo has a project
    let hasProject = false;
    try {
      const projects = await octokit.projects.listForRepo({ owner, repo });
      hasProject = projects.data.length > 0;
    } catch (err) {
      diagnostics.errors.push(`[${repoName}] Error checking for project: ${err.message}`);
      if (VERBOSE) {
        console.error(`[${repoName}] Error checking for project:`, err);
      }
    }
    if (!hasProject) {
      if (VERBOSE) {
        console.log(`No project found in this repo.`);
      }
      continue;
    }
    // Process open PRs
    let prState = 'open';
    let prMerged = false;
    let prProcessed = 0;
    let prAdded = 0;
    let prUpdated = 0;
    let prSkipped = 0;
    try {
      const prs = await octokit.pulls.list({
        owner,
        repo,
        state: prState,
        per_page: 100
      });
      for (const pr of prs.data) {
        prProcessed++;
        const result = await addItemToProjectAndSetStatus(
          pr.node_id, 'PR', pr.number, null, '', repoName, prState, pr.merged, diagnostics
        );
        if (result.added) prAdded++;
        else if (result.updated) prUpdated++;
        else prSkipped++;
      }
    } catch (err) {
      diagnostics.errors.push(`[${repoName}] Error processing PRs: ${err.message}`);
      if (VERBOSE) {
        console.error(`[${repoName}] Error processing PRs:`, err);
      }
    }
    // Process closed PRs (for linking issues)
    prState = 'closed';
    prProcessed = 0;
    prAdded = 0;
    prUpdated = 0;
    prSkipped = 0;
    try {
      const prs = await octokit.pulls.list({
        owner,
        repo,
        state: prState,
        per_page: 100
      });
      for (const pr of prs.data) {
        prProcessed++;
        const result = await addItemToProjectAndSetStatus(
          pr.node_id, 'PR', pr.number, null, '', repoName, prState, pr.merged, diagnostics
        );
        if (result.added) prAdded++;
        else if (result.updated) prUpdated++;
        else prSkipped++;
      }
    } catch (err) {
      diagnostics.errors.push(`[${repoName}] Error processing closed PRs: ${err.message}`);
      if (VERBOSE) {
        console.error(`[${repoName}] Error processing closed PRs:`, err);
      }
    }
    // Process issues assigned to GITHUB_AUTHOR
    let processed = 0, added = 0, updated = 0, skipped = 0;
    try {
      // Use current date for sinceDate
      const now = new Date();
      const sinceDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      let issuesQuery = {
        owner,
        repo,
        state: "open",
        per_page: 50
      };
      issuesQuery.assignee = GITHUB_AUTHOR;
      let page = 1;
      while (true) {
        const { data: issues } = await octokit.issues.listForRepo({ ...issuesQuery, page });
        if (issues.length === 0) break;
        for (const issue of issues) {
          if (issue.pull_request) continue;
          processed++;
          const updatedAt = new Date(issue.updated_at || issue.created_at);
          if (updatedAt < sinceDate) { skipped++; continue; }
          try {
            // Issues from repo.yml: isRepoYml=true, isAssignedToUser if assigned, isLinkedToPR=false
            const isRepoYml = true;
            const isAssignedToUser = (issue.assignees || []).some(a => a.login === GITHUB_AUTHOR);
            const isLinkedToPR = false;
            const result = await addItemToProjectAndSetStatus(
              issue.node_id, 'issue', issue.number, null, '', repoName, undefined, undefined, diagnostics,
              isRepoYml, isAssignedToUser, isLinkedToPR, statusFieldOptions
            );
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
    } catch (err) {
      console.error('Error in addAssignedIssuesToProject:', err);
      diagnostics.errors.push('Error in addAssignedIssuesToProject: ' + err.message);
    }
    // Summary output for this repo
    if (VERBOSE) {
      console.log(`Processed ${prProcessed} PRs (added: ${prAdded}, updated: ${prUpdated}, skipped: ${prSkipped})`);
      console.log(`Processed ${processed} issues (added: ${added}, updated: ${updated}, skipped: ${skipped})`);
    } else {
      process.stdout.write(`Processed ${prProcessed} PRs, ${processed} issues... `);
    }
  }
}

// === MAIN EXECUTION ===
async function run() {
  const diagnostics = new DiagnosticsContext();
  console.log('=== GitHub Project Automation Script ===');
  console.log(`Started at: ${new Date().toISOString()}`);
  try {
    await processProjectBoard(diagnostics);
  } catch (err) {
    console.error('Unexpected error in run():', err);
    diagnostics.errors.push('Unexpected error in run(): ' + err.message);
  }
  // Final diagnostics summary
  console.log('\n=== Summary ===');
  if (diagnostics.errors.length > 0) {
    console.log(`Errors: ${diagnostics.errors.length}`);
    for (const err of diagnostics.errors) {
      console.log(`- ${err}`);
    }
  } else {
    console.log('No errors encountered.');
  }
  console.log('Finished at: ' + new Date().toISOString());
}

run();
