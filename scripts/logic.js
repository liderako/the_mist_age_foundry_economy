import { COSTS, COUNTERS, INFLUENCE_LEVELS, NEEDS, PEOPLE_PER_SUPPLY } from "./constants.js";

// Pure rules of the economy, working on plain system data, so they run the same in the sheets, the daily tick and tests.

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

/**
 * A city's people from its groups: residents and guards are the sums of the groups of each kind; those of groups that
 * can work may be taken for projects.
 */
export function countPeople(groups) {
	const total = predicate => sum(groups.filter(predicate).map(group => group.count));
	return { population: total(group => !group.guard), guards: total(group => group.guard), workforce: total(group => group.canWork) };
}

/** People busy on active projects and those still free, out of the groups that can work. */
export function getWorkers(data, { except = null } = {}) {
	const busy = sum(data.projects.filter(project => project.status === "active" && project.id !== except).map(project => project.workers));
	return { busy, free: countPeople(data.groups).workforce - busy };
}

function newId() {
	return Array.from({ length: 16 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
}

/** A new group of residents or guards; guards keep watch and do not work on projects by default. */
export function newGroup(guard, name) {
	return { id: newId(), name, count: 0, guard, canWork: !guard };
}

/** Supplies a city's people need: one level for every thousand residents and guards, a started thousand counting. */
export function supplyNeed(groups) {
	const { population, guards } = countPeople(groups);
	return Math.ceil((population + guards) / PEOPLE_PER_SUPPLY);
}

/** Counters a city has less of, after effects, than its people and features need. */
export function getShortages(data) {
	return NEEDS.filter(key => data.counters[key].value < data.needs[key]);
}

/**
 * What needs the GM's attention: more work than free residents, less Supplies or Materials than needed, a counter of
 * order or stability at zero.
 */
export function getAlerts(data) {
	const alerts = [];
	if (getWorkers(data).free < 0) {
		alerts.push("workers");
	}
	for (const key of getShortages(data)) {
		alerts.push(`short.${key}`);
	}
	for (const key of ["stability", "order"]) {
		if (data.counters[key].max > 0 && data.counters[key].value === 0) {
			alerts.push(key);
		}
	}
	return alerts;
}

/** A lasting project that has worked its days is built: it runs until it is switched off. */
export function isBuilt(project) {
	return project.kind === "lasting" && project.progress >= project.days;
}

/** A lasting project holds its features while it runs: active and built. */
export function holdsFeatures(project) {
	return project.status === "active" && isBuilt(project);
}

/** A project that counts for influence: a lasting one running, or a one-time one completed. */
export function isEstablished(project) {
	return holdsFeatures(project) || (project.kind === "once" && project.status === "completed");
}

/** How strong a share of a city's running projects is; "none" without any. */
export function influenceLevel(share, projects) {
	return projects ? INFLUENCE_LEVELS.find(entry => share < entry.below).level : "none";
}

/**
 * An organization's weight in a city: the influence of its running projects out of all the city's running ones (each
 * project weighs its influence, 1 unless set), that share and its
 * level, and the projects it is still building, which give no influence yet. The members are the organizations whose
 * projects count as its own: itself and those that are part of it. A project also counts for the organizations it
 * strengthens (temple knights in a city held by a noble house); in the total it counts once. The modifier, from effects
 * (a weakened syndicate: −1), is added to its running projects, never below none.
 */
export function cityInfluence(projects, organization, members = [organization], modifier = 0) {
	const ours = new Set(members);
	const running = projects.filter(isEstablished);
	const own = Math.max(0, weigh(running.filter(project => backs(project, ours))) + modifier);
	const building = projects.filter(project => backs(project, ours) && project.status === "active" && !isEstablished(project)).length;
	const total = weigh(running);
	const share = total ? own / total : 0;
	return { projects: own, building, total, share, level: influenceLevel(share, own) };
}

/** The organizations a project gives influence to: its own, then those it also strengthens. */
export function projectBackers(project) {
	return [project.organization, ...(project.allies ?? [])].filter(Boolean);
}

/** True when a project gives influence to one of these organizations. */
export function backs(project, organizations) {
	return projectBackers(project).some(uuid => organizations.has(uuid));
}

/** The influence projects weigh together: each its own weight, 1 unless set. */
function weigh(projects) {
	return projects.reduce((sum, project) => sum + (project.influence ?? 1), 0);
}

/** The organizations above one, nearest first, from a map of each organization to the one it is part of. */
export function organizationAncestors(organization, parents) {
	const ancestors = [];
	for (let parent = parents.get(organization); parent && parent !== organization && !ancestors.includes(parent); parent = parents.get(parent)) {
		ancestors.push(parent);
	}
	return ancestors;
}

/** An organization and every organization that is part of it, at any depth. */
export function organizationFamily(organization, parents) {
	return [organization, ...[...parents.keys()].filter(other => other !== organization && organizationAncestors(other, parents).includes(organization))];
}

/**
 * What effects add to the influence of organizations: each effect may carry {organization: uuid, amount} pairs under
 * its "influence" flag, and changes "system.influence.<organization id>". Returns a map of organization uuid to the
 * summed amount.
 */
export function influenceModifiers(effects) {
	const modifiers = new Map();
	const add = (organization, amount) => modifiers.set(organization, (modifiers.get(organization) ?? 0) + amount);
	for (const entry of effects.flatMap(effect => effect.influence ?? [])) {
		if (entry?.organization && Number.isFinite(Number(entry.amount))) {
			add(entry.organization, Number(entry.amount));
		}
	}
	// A change "system.influence.<organization id>" Add N, as the effect editor offers it.
	for (const change of effects.flatMap(effect => effect.changes ?? [])) {
		const match = String(change?.key ?? "").match(INFLUENCE_KEY);
		if (match && (change.type ?? "add") === "add" && Number.isFinite(Number(change.value))) {
			add(`Actor.${match[1]}`, Number(change.value));
		}
	}
	return modifiers;
}

/** The key of an effect change adding to an organization's influence in a city. */
export const INFLUENCE_KEY = /^system\.influence\.(\w+)$/;

/** The organizations a city's projects name, or strengthen, each once. */
export function projectOrganizations(projects) {
	return [...new Set(projects.flatMap(projectBackers))];
}

/** Counter values a project lacks to start: {materials: 2} when 2 more materials are needed. */
export function getShortfalls(data, project) {
	const shortfalls = {};
	for (const key of COSTS) {
		const missing = project.cost[key] - data.counters[key].value;
		if (project.cost[key] > 0 && missing > 0) {
			shortfalls[key] = missing;
		}
	}
	return shortfalls;
}

/** Pays a project's cost out of the counters (never below zero) and makes it active. */
export function startProject(data, projectId) {
	const project = data.projects.find(entry => entry.id === projectId);
	for (const key of COSTS) {
		data.counters[key].value = Math.max(0, data.counters[key].value - project.cost[key]);
	}
	project.status = "active";
	project.progress = 0;
	return data;
}

export function emptyReport(days = 0) {
	return { days, completed: [], built: [], unlocked: [], features: [] };
}

/**
 * Lets days pass for a city's projects. Each day every active project that is not built yet advances; when it has
 * worked its days, it unlocks projects, and a lasting one is built and runs from then on, holding its features, while a
 * one-time one is completed and leaves its features for good. Counters change only through features' effects; nothing
 * is eaten or produced day by day.
 */
export function advanceDays(source, days) {
	const data = structuredClone(source);
	const report = emptyReport(days);
	for (let day = 0; day < days; day++) {
		for (const project of data.projects) {
			if (project.status !== "active" || isBuilt(project)) {
				continue;
			}
			project.progress += 1;
			if (project.progress >= project.days) {
				finishProject(data, project, report);
			}
		}
	}
	return { data, report };
}

/** A project that has worked its days unlocks projects; a lasting one is built, a one-time one completed with its features. */
function finishProject(data, project, report) {
	for (const id of project.unlocks) {
		const unlocked = data.projects.find(entry => entry.id === id);
		if (unlocked?.status === "locked") {
			unlocked.status = "available";
			report.unlocked.push(id);
		}
	}
	if (project.kind === "lasting") {
		report.built.push(project.id);
		return;
	}
	project.status = "completed";
	report.completed.push(project.id);
	for (const grant of project.grants) {
		report.features.push({ grant, source: project.name });
	}
}

/**
 * Completes the one-time projects that are under way with no days left to work: started with 0 days, or marked built
 * by the GM. They need not wait for the next day.
 */
export function settleProjects(source) {
	const data = structuredClone(source);
	const report = emptyReport();
	for (const project of data.projects) {
		if (project.kind === "once" && project.status === "active" && project.progress >= project.days) {
			finishProject(data, project, report);
		}
	}
	return { data, report };
}

/** True when a report has something worth posting. */
export function hasNews(report) {
	return Boolean(report.completed.length || report.built.length || report.unlocked.length || report.features.length);
}

// A city's feature changes its counters; a region's or country's, the bonuses it gives every city inside.
const GIVES_KEY = /^system\.(?:counters|bonuses)\.(\w+)\.(value|max)$/;
const NEEDS_KEY = /^system\.needs\.(\w+)$/;

/**
 * What a feature's effect changes give and need: {gives: {supplies: 1}, needs: {materials: 1}}. A resource it gives is
 * read from what it adds to the counter's value, or for a region or country, to every city's; other changes are left
 * alone.
 */
export function readResources(changes) {
	const resources = { gives: {}, needs: {} };
	for (const change of changes) {
		const amount = Number(change.value);
		if ((change.type ?? "add") !== "add" || !Number.isFinite(amount)) {
			continue;
		}
		const gives = change.key.match(GIVES_KEY);
		const needs = change.key.match(NEEDS_KEY);
		if (gives?.[2] === "value" && COUNTERS.includes(gives[1])) {
			resources.gives[gives[1]] = (resources.gives[gives[1]] ?? 0) + amount;
		} else if (needs && NEEDS.includes(needs[1])) {
			resources.needs[needs[1]] = (resources.needs[needs[1]] ?? 0) + amount;
		}
	}
	return resources;
}

/** True when an effect change is one of the resources a feature gives or needs. */
export function isResourceChange(change) {
	return GIVES_KEY.test(change.key) || NEEDS_KEY.test(change.key);
}

/**
 * The effect changes for resources: Supplies +1 adds 1 to the counter's maximum and value; a need adds to the need. On a
 * region or country ("area") the changes go to the bonuses it gives every city inside; needs belong to cities only.
 */
export function resourceChanges({ gives, needs }, scope = "city") {
	const change = (key, amount) => ({ key, type: "add", value: String(amount), phase: "initial" });
	const counters = scope === "area" ? "bonuses" : "counters";
	return [
		...Object.entries(gives).filter(([, amount]) => amount).flatMap(([key, amount]) => [change(`system.${counters}.${key}.max`, amount), change(`system.${counters}.${key}.value`, amount)]),
		...(scope === "area" ? [] : Object.entries(needs).filter(([, amount]) => amount).map(([key, amount]) => change(`system.needs.${key}`, amount)))
	];
}

/** A feature's description from plain text: each line a paragraph. */
export function textToHtml(text) {
	const escape = line => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => `<p>${escape(line)}</p>`).join("");
}
