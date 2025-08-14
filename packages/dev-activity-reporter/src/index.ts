import { Octokit } from "@octokit/core";
import { paginateGraphql } from "@octokit/plugin-paginate-graphql";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MyOctokit = (Octokit as any).plugin(paginateGraphql as any);

type Inputs = {
	org: string;
	users: string[];
	repos?: string[];
	from: string;
	to: string;
	format: ("md" | "json")[];
	outDir: string;
};

type Metrics = {
	prsOpened: number;
	prsMerged: number;
	linesChanged: number;
	issuesOpened: number;
	comments: number;
	prsReviewed: number;
};

function parseArgs(argv: string[]): Inputs {
	const args = new Map<string, string>();
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
			args.set(key, val);
		}
	}
	const org = args.get("org") ?? "bcgov";
	const users = (args.get("users") ?? "").split(",").map(s => s.trim()).filter(Boolean);
	const repos = (args.get("repos") ?? "").split(",").map(s => s.trim()).filter(Boolean);
	const from = args.get("from") ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
	const to = args.get("to") ?? new Date().toISOString().slice(0, 10);
	const format = (args.get("format") ?? "md,json").split(",").map(s => s.trim().toLowerCase()).filter(Boolean) as ("md"|"json")[];
	const outDir = args.get("outDir") ?? path.join("reports", to);
	return { org, users, repos: repos.length ? repos : undefined, from, to, format, outDir };
}

async function searchCount(octo: any, query: string): Promise<number> {
	const q = `query($q: String!) { search(type: ISSUE, query: $q, first: 1) { issueCount } }`;
	const res = await octo.graphql(q, { q: query });
	return (res as any).search.issueCount as number;
}

async function sumLinesChanged(octo: any, query: string): Promise<number> {
	const q = `query($q: String!, $after: String) {
		search(type: ISSUE, query: $q, first: 50, after: $after) {
			pageInfo { hasNextPage endCursor }
			nodes { ... on PullRequest { additions deletions } }
		}
	}`;
	let total = 0;
	let after: string | null = null;
	do {
		const res: any = await octo.graphql(q, { q: query, after });
		for (const n of res.search.nodes) {
			if (n && typeof n.additions === "number" && typeof n.deletions === "number") {
				total += n.additions + n.deletions;
			}
		}
		after = res.search.pageInfo.hasNextPage ? res.search.pageInfo.endCursor : null;
	} while (after);
	return total;
}

function repoScope(org: string, repos?: string[]): string {
	return repos && repos.length ? repos.map(r => `repo:${r}`).join(" ") : `org:${org}`;
}

function queriesFor(user: string, org: string, from: string, to: string, repos?: string[]) {
	const scope = repoScope(org, repos);
	return {
		prsOpened: `${scope} is:pr author:${user} created:${from}..${to}`,
		prsMerged: `${scope} is:pr is:merged author:${user} merged:${from}..${to}`,
		issuesOpened: `${scope} is:issue author:${user} created:${from}..${to}`,
		comments: `${scope} commenter:${user} updated:${from}..${to}`,
		prsReviewed: `${scope} is:pr reviewed-by:${user} updated:${from}..${to}`,
	};
}

function renderMarkdown(perUser: Record<string, Metrics>, inputs: Inputs): string {
	const header = `# Dev Activity Report\nOrg: ${inputs.org}\nWindow: ${inputs.from}..${inputs.to}\nRepos: ${inputs.repos?.join(", ") || "(all in org)"}\n\n`;
	const tableHeader = `| User | PRs Opened | PRs Merged | Lines Changed | Issues Opened | Comments | PRs Reviewed |\n|---|---:|---:|---:|---:|---:|---:|\n`;
	const rows = Object.entries(perUser).map(([user, m]) => `| ${user} | ${m.prsOpened} | ${m.prsMerged} | ${m.linesChanged} | ${m.issuesOpened} | ${m.comments} | ${m.prsReviewed} |`).join("\n");
	return header + tableHeader + rows + "\n";
}

async function writeOutputs(perUser: Record<string, Metrics>, inputs: Inputs) {
	await mkdir(inputs.outDir, { recursive: true });
	if (inputs.format.includes("json")) {
		await writeFile(path.join(inputs.outDir, "dev-activity.json"), JSON.stringify({ inputs, perUser }, null, 2));
	}
	if (inputs.format.includes("md")) {
		await writeFile(path.join(inputs.outDir, "dev-activity.md"), renderMarkdown(perUser, inputs));
	}
}

async function run(inputs: Inputs) {
	if (!process.env.GITHUB_TOKEN) {
		throw new Error("GITHUB_TOKEN is required (provided automatically in GitHub Actions).");
	}
	if (!inputs.users.length) {
		throw new Error("At least one --users login is required (comma-separated).");
	}
	const octo = new MyOctokit({ auth: process.env.GITHUB_TOKEN });
	const perUser: Record<string, Metrics> = {};
	for (const user of inputs.users) {
		const q = queriesFor(user, inputs.org, inputs.from, inputs.to, inputs.repos);
		const [prsOpened, prsMerged, issuesOpened, comments, prsReviewed, linesChanged] = await Promise.all([
			searchCount(octo, q.prsOpened),
			searchCount(octo, q.prsMerged),
			searchCount(octo, q.issuesOpened),
			searchCount(octo, q.comments),
			searchCount(octo, q.prsReviewed),
			sumLinesChanged(octo, q.prsMerged),
		]);
		perUser[user] = { prsOpened, prsMerged, linesChanged, issuesOpened, comments, prsReviewed };
	}
	await writeOutputs(perUser, inputs);
}

(async () => {
	try {
		const inputs = parseArgs(process.argv);
		await run(inputs);
		console.log(`Report written to ${inputs.outDir}`);
	} catch (err: any) {
		console.error(err?.message || err);
		process.exit(1);
	}
})();
