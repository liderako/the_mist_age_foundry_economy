import { COSTS, COUNTERS, PEOPLE } from "./constants.js";

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

/** The maximum of each counter the rules use: the stored one, or the one after effects when given. */
export function counterMaxima(data) {
	return Object.fromEntries(COUNTERS.map(key => [key, data.counters[key].max]));
}

/**
 * Sets a counter to a value between 0 and its maximum. Effects may add to the value too; the stored value is what the
 * GM sets, so a prepared value is turned back into a stored one by taking away what effects add.
 */
export function clampCounter(value, max) {
	return Math.max(0, Math.min(Math.round(value), max));
}

/** What needs the GM's attention: more work than free residents, a counter of order or stability at zero. */
export function getAlerts(data) {
	const alerts = [];
	if (getWorkers(data).free < 0) {
		alerts.push("workers");
	}
	for (const key of ["stability", "order"]) {
		if (data.counters[key].max > 0 && data.counters[key].value === 0) {
			alerts.push(key);
		}
	}
	return alerts;
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
	return { days, gains: {}, lost: {}, yields: {}, completed: [], unlocked: [], features: [] };
}

function add(target, key, amount) {
	target[key] = (target[key] ?? 0) + amount;
}

function rollAmount(reward, random) {
	if (reward.mode !== "range") {
		return reward.amount;
	}
	const low = Math.min(reward.min, reward.max);
	const high = Math.max(reward.min, reward.max);
	if (reward.whole) {
		const from = Math.round(low);
		return from + Math.floor(random() * (Math.round(high) - from + 1));
	}
	return low + random() * (high - low);
}

/**
 * A reward moves a counter up to its maximum (what does not fit is lost) or adds residents or guards to the city's first
 * group of that kind, which is made when the city has none.
 */
function grantRewards(data, project, random, report, maxima, groupNames) {
	for (const reward of project.rewards) {
		if (reward.chance <= 0 || (reward.chance < 1 && random() > reward.chance)) {
			continue;
		}
		const amount = Math.round(rollAmount(reward, random));
		if (!amount) {
			continue;
		}
		let added = amount;
		if (PEOPLE.includes(reward.target)) {
			const guard = reward.target === "guards";
			let group = data.groups.find(entry => entry.guard === guard);
			if (!group) {
				group = newGroup(guard, groupNames[reward.target]);
				data.groups.push(group);
			}
			added = Math.max(-group.count, amount);
			group.count += added;
		} else {
			const counter = data.counters[reward.target];
			const next = clampCounter(counter.value + amount, maxima[reward.target]);
			added = next - counter.value;
			counter.value = next;
			if (added < amount) {
				add(report.lost, reward.target, amount - added);
			}
		}
		add(report.yields[project.id] ??= {}, reward.target, added);
		add(report.gains, reward.target, added);
	}
}

/**
 * Lets days pass for a city's projects. Each day every active project advances; when it has worked its days it gives
 * its rewards and starts over, or is completed, unlocking projects and leaving features. Counters change only through
 * rewards; nothing is eaten or produced day by day. The maxima are the counters' maxima after effects; the group names
 * name a group of residents or guards that a reward has to make.
 */
export function advanceDays(source, days, random = Math.random, maxima = counterMaxima(source), groupNames = { population: "Residents", guards: "Guards" }) {
	const data = structuredClone(source);
	const report = emptyReport(days);
	for (let day = 0; day < days; day++) {
		for (const project of data.projects) {
			if (project.status !== "active") {
				continue;
			}
			project.progress += 1;
			if (project.progress < Math.max(project.days, 1)) {
				continue;
			}
			grantRewards(data, project, random, report, maxima, groupNames);
			if (project.repeat) {
				project.progress = 0;
				continue;
			}
			project.status = "completed";
			report.completed.push(project.id);
			for (const grant of project.grants) {
				report.features.push({ grant, source: project.name });
			}
			for (const id of project.unlocks) {
				const unlocked = data.projects.find(entry => entry.id === id);
				if (unlocked?.status === "locked") {
					unlocked.status = "available";
					report.unlocked.push(id);
				}
			}
		}
	}
	return { data, report };
}

/** True when a report has something worth posting. */
export function hasNews(report) {
	return Boolean(Object.keys(report.gains).length || report.completed.length || report.unlocked.length || report.features.length);
}

/** A feature's description from plain text: each line a paragraph. */
export function textToHtml(text) {
	const escape = line => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => `<p>${escape(line)}</p>`).join("");
}
