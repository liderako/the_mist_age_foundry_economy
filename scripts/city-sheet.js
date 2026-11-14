import { CITY_TYPE, COSTS, COUNTERS, ICONS, MAX_BOXES, MODULE_ID, NEEDS, PEOPLE, PROJECT_STATUSES } from "./constants.js";
import { advanceButton, alertText, askDays } from "./days.js";
import { FEATURE_ACTIONS, featureGroup } from "./features.js";
import { effectiveCounters, getCountry, getRegion, storedCounterValue } from "./hierarchy.js";
import { getAlerts, getShortfalls, getWorkers, isBuilt, newGroup, startProject } from "./logic.js";
import { ProjectConfig } from "./project-config.js";
import { influenceRows } from "./influence.js";
import { featureResources, resourceText } from "./resources.js";
import { currentDate } from "./time.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const TEMPLATES = `modules/${MODULE_ID}/templates`;

export function localize(key, data) {
	return data ? game.i18n.format(`MIST_ECO.${key}`, data) : game.i18n.localize(`MIST_ECO.${key}`);
}

/** "+3" or "-1"; nothing for zero. */
export function signed(value) {
	return value > 0 ? `+${value}` : value < 0 ? `${value}` : "";
}

/**
 * A counter as the sheets draw it: boxes up to its maximum like a Daggerheart tracker, or a number when it is large.
 * With a need, the first filled boxes are used by it, and the boxes it lacks are marked missing, past the maximum too.
 */
export function counterView(key, counter, extra = {}) {
	const need = extra.need ?? 0;
	const used = Math.min(need, counter.value);
	const drawn = counter.max <= MAX_BOXES;
	return {
		key,
		icon: ICONS[key],
		label: localize(`Resources.${key}`),
		// What the counter means, so stability and order are not mixed up.
		about: localize(`Counters.About.${key}`),
		value: counter.value,
		max: counter.max,
		// What is left once the need has taken its share: 6 with a need of 5 shows as 1/6; a lack shows below zero.
		available: counter.value - need,
		used,
		free: counter.value - used,
		missing: Math.max(0, need - counter.value),
		boxes: drawn ? Array.from({ length: counter.max }, (_, index) => ({
			index: index + 1,
			filled: index < counter.value,
			used: index < used,
			missing: index >= counter.value && index < need
		})) : null,
		// What the need lacks beyond the maximum, drawn as boxes that are not there.
		beyond: drawn ? Array.from({ length: Math.max(0, need - Math.max(counter.max, counter.value)) }) : [],
		...extra
	};
}

/** A city's counters with what they are made of: its own maximum and what effects add; Supplies and Materials, with what the city needs. */
function cityCounters(actor) {
	const effective = effectiveCounters(actor);
	const source = actor._source.system.counters;
	const needs = actor.system.needs;
	return COUNTERS.map(key => counterView(key, effective[key], {
		baseMax: source[key].max,
		bonusMax: signed(effective[key].max - source[key].max),
		...(NEEDS.includes(key) ? { need: needs[key], short: effective[key].value < needs[key] } : {}),
		// Supplies are eaten by the people, and features add to or take from that.
		...(key === "supplies" ? { needParts: localize("Needs.Parts", { people: actor.system.peopleNeed, features: signed(needs[key] - actor.system.peopleNeed) || "0" }) } : {})
	}));
}

// Project sections and organization groups the user folded, kept between renders and sessions in this browser.
const COLLAPSED_KEY = `${MODULE_ID}.collapsed`;
const collapsed = new Set((() => {
	try {
		return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
	} catch {
		return [];
	}
})());

function setCollapsed(key, folded) {
	if (folded) {
		collapsed.add(key);
	} else {
		collapsed.delete(key);
	}
	try {
		localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
	} catch {
		// Only remembered for this session.
	}
}

/**
 * Projects grouped by the organization behind them, by name; those of no organization last.
 */
function organizationGroups(projects) {
	const groups = new Map();
	for (const project of projects) {
		const key = project.organizationName ? project.organization : "";
		if (!groups.has(key)) {
			const organization = key ? fromUuidSync(key, { strict: false }) : null;
			groups.set(key, { uuid: key, name: organization?.name ?? localize("Organization.None"), img: organization?.img ?? "", projects: [] });
		}
		groups.get(key).projects.push(project);
	}
	return [...groups.values()].sort((a, b) => (!a.uuid - !b.uuid) || a.name.localeCompare(b.name, game.i18n.lang));
}

/**
 * Sheet of a city: its people and counters (supplies, materials, stability, order, religious harmony, power), which features raise
 * and the GM moves like Daggerheart trackers; its projects; and its features and effects. Days pass with the world time
 * for the projects of every city at once.
 */
export class CitySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["mist-eco"],
		position: { width: 860, height: 800 },
		window: { resizable: true },
		form: { submitOnChange: true },
		actions: {
			nextDay: () => advanceButton(1),
			passDays: CitySheet.#onPassDays,
			openLink: CitySheet.#onOpenLink,
			setCounter: CitySheet.#onSetCounter,
			adjustCounter: CitySheet.#onAdjustCounter,
			createProject: CitySheet.#onCreateProject,
			editProject: CitySheet.#onEditProject,
			deleteProject: CitySheet.#onDeleteProject,
			startProject: CitySheet.#onStartProject,
			pauseProject: CitySheet.#onPauseProject,
			resumeProject: CitySheet.#onResumeProject,
			unlockProject: CitySheet.#onUnlockProject,
			reopenProject: CitySheet.#onReopenProject,
			buildProject: CitySheet.#onBuildProject,
			copyProject: CitySheet.#onCopyProject,
			addGroup: CitySheet.#onAddGroup,
			deleteGroup: CitySheet.#onDeleteGroup,
			...FEATURE_ACTIONS
		}
	};

	static PARTS = {
		header: { template: `${TEMPLATES}/city-header.hbs` },
		tabs: { template: "templates/generic/tab-navigation.hbs" },
		overview: { template: `${TEMPLATES}/city-overview.hbs`, scrollable: [""] },
		projects: { template: `${TEMPLATES}/city-projects.hbs`, scrollable: [""] },
		organizations: { template: `${TEMPLATES}/city-organizations.hbs`, scrollable: [""] },
		features: { template: `${TEMPLATES}/features.hbs`, scrollable: [""] },
		effects: { template: `${TEMPLATES}/effects.hbs`, scrollable: [""] }
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "overview", icon: "fa-solid fa-city" },
				{ id: "projects", icon: "fa-solid fa-hammer" },
				{ id: "organizations", icon: "fa-solid fa-landmark-flag" },
				{ id: "features", icon: "fa-solid fa-star" },
				{ id: "effects", icon: "fa-solid fa-wand-magic-sparkles" }
			],
			initial: "overview",
			labelPrefix: "MIST_ECO.Tabs"
		}
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const actor = this.document;
		const system = actor.system;
		const region = getRegion(actor);
		const country = getCountry(actor);
		const enrich = html => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo: actor, secrets: actor.isOwner });
		const projectName = id => system.projects.find(project => project.id === id)?.name ?? "";
		const views = await Promise.all(system.projects.map(async project => ({
			...this.#projectView(project, projectName),
			description: await enrich(project.description)
		})));
		const isGM = game.user.isGM;
		return Object.assign(context, {
			actor,
			system,
			source: actor._source.system,
			isGM,
			isCity: true,
			editable: this.isEditable,
			date: currentDate(),
			icons: ICONS,
			region: region && { uuid: region.uuid, name: region.name, img: region.img },
			country: country && { uuid: country.uuid, name: country.name, img: country.img },
			counters: cityCounters(actor),
			people: PEOPLE.map(key => ({ key, icon: ICONS[key], label: localize(`Resources.${key}`), value: system[key] })),
			groups: system.groups.map(group => ({ ...group, icon: ICONS[group.guard ? "guards" : "population"] })),
			workers: { ...getWorkers(system), short: getWorkers(system).free < 0 },
			alerts: alertText(getAlerts({ groups: system.groups, projects: system.projects, needs: system.needs, counters: effectiveCounters(actor) })),
			sections: PROJECT_STATUSES.filter(status => isGM || status !== "locked").map(status => ({
				status,
				label: localize(`Status.${status}`),
				projects: views.filter(project => project.status === status)
			})).filter(section => section.projects.length || ["active", "available"].includes(section.status))
				.map(section => {
					const key = `${actor.id}.${section.status}`;
					return {
						...section,
						collapseKey: key,
						open: !collapsed.has(key),
						groups: organizationGroups(section.projects).map(group => ({ ...group, collapseKey: `${key}.${group.uuid || "none"}`, open: !collapsed.has(`${key}.${group.uuid || "none"}`) }))
					};
				}),
			influence: influenceRows([actor]),
			featureGroups: [await featureGroup(actor, { editable: this.isEditable })],
			enrichedDescription: await enrich(system.description)
		});
	}

	async _preparePartContext(partId, context, options) {
		context = await super._preparePartContext(partId, context, options);
		if (partId in context.tabs) {
			context.tab = context.tabs[partId];
		}
		return context;
	}

	/** Group inputs are named groups.<id>.<field>; they update that group. */
	_processFormData(event, form, formData) {
		const data = super._processFormData(event, form, formData);
		const changes = data.groups;
		delete data.groups;
		if (changes) {
			data.system ??= {};
			data.system.groups = this.document.system.toObject().groups.map(group => (changes[group.id] ? { ...group, ...changes[group.id] } : group));
		}
		return data;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		for (const details of this.element.querySelectorAll("details[data-collapse]")) {
			details.addEventListener("toggle", () => setCollapsed(details.dataset.collapse, !details.open));
		}
		if (!this.isEditable) {
			for (const input of this.element.querySelectorAll("input, select, textarea, prose-mirror, button[data-action$='Counter']")) {
				input.disabled = true;
			}
		}
	}

	/** A project as the sheet lists it; each feature it gives shows what that feature gives and needs. */
	#projectView(project, projectName) {
		const label = key => localize(`Resources.${key}`);
		const grantText = grant => {
			const resources = resourceText(featureResources(grant.uuid ? fromUuidSync(grant.uuid, { strict: false }) : null));
			const where = grant.target === "city" ? "" : localize(`Features.Target.${grant.target}`);
			const details = [where, resources].filter(Boolean).join("; ");
			return details ? `${grant.name} (${details})` : grant.name;
		};
		const organization = project.organization ? fromUuidSync(project.organization, { strict: false }) : null;
		return {
			...project,
			// A project whose organization was deleted shows none.
			organizationName: organization?.name ?? "",
			allyNames: (project.allies ?? []).map(uuid => fromUuidSync(uuid, { strict: false })).filter(Boolean).map(ally => ({ uuid: ally.uuid, name: ally.name })),
			kindLabel: localize(`Project.Kind.${project.kind}`),
			working: isBuilt(project),
			grantsLabel: localize(project.kind === "once" ? "Features.Leaves" : "Features.Holds"),
			percent: project.days ? Math.min(100, Math.round(project.progress / project.days * 100)) : 0,
			cost: Object.entries(project.cost).filter(([, amount]) => amount).map(([key, amount]) => `${amount} ${label(key)}`).join(", "),
			unlocks: project.unlocks.map(projectName).filter(Boolean).join(", "),
			grants: project.grants.map(grantText).join(", "),
			canStart: project.status === "available",
			canPause: project.status === "active",
			canResume: project.status === "paused",
			canUnlock: project.status === "locked",
			canReopen: project.status === "completed",
			// The GM can set a lasting project up as already built, so a world starts with what it already has.
			canBuild: game.user.isGM && !isBuilt(project) && ["available", "active", "paused"].includes(project.status)
		};
	}

	/** A city takes Daggerheart features, with their effects; other items belong to characters. */
	async _onDropItem(event, item) {
		return item.type === "feature" ? super._onDropItem(event, item) : null;
	}

	/** Sets a counter to the shown value, between 0 and its maximum after effects. */
	async #setCounter(key, wanted) {
		const max = effectiveCounters(this.document)[key].max;
		const value = Math.max(0, Math.min(max, wanted));
		await this.document.update({ [`system.counters.${key}.value`]: storedCounterValue(this.document, key, value) });
	}

	/** A box sets the counter to it; the last filled box clears itself, as on Daggerheart trackers. */
	static async #onSetCounter(event, target) {
		const { key } = target.closest("[data-counter]").dataset;
		const index = Number(target.dataset.value);
		const current = effectiveCounters(this.document)[key].value;
		await this.#setCounter(key, index === current ? index - 1 : index);
	}

	static async #onAdjustCounter(event, target) {
		const { key } = target.closest("[data-counter]").dataset;
		await this.#setCounter(key, effectiveCounters(this.document)[key].value + Number(target.dataset.delta));
	}

	#project(target) {
		const id = target.closest("[data-project-id]").dataset.projectId;
		return this.document.system.projects.find(project => project.id === id);
	}

	async #updateProject(id, changes) {
		const projects = this.document.system.toObject().projects;
		Object.assign(projects.find(project => project.id === id), changes);
		await this.document.update({ "system.projects": projects });
	}

	static async #onPassDays() {
		const days = await askDays();
		if (days > 0) {
			await advanceButton(days);
		}
	}

	static #onOpenLink(event, target) {
		fromUuidSync(target.dataset.uuid, { strict: false })?.sheet.render({ force: true });
	}

	static #onCreateProject() {
		new ProjectConfig(this.document).render({ force: true });
	}

	static #onEditProject(event, target) {
		new ProjectConfig(this.document, this.#project(target).id).render({ force: true });
	}

	static async #onDeleteProject(event, target) {
		const project = this.#project(target);
		const confirmed = await DialogV2.confirm({
			window: { title: localize("Project.Delete") },
			content: `<p>${localize("Project.DeleteConfirm", { name: foundry.utils.escapeHTML(project.name) })}</p>`
		});
		if (!confirmed) {
			return;
		}
		const projects = this.document.system.toObject().projects
			.filter(entry => entry.id !== project.id)
			.map(entry => ({ ...entry, unlocks: entry.unlocks.filter(id => id !== project.id) }));
		await this.document.update({ "system.projects": projects });
	}

	/** Checks the cost and the free residents, then starts the project, paying its cost out of the counters as shown. */
	static async #onStartProject(event, target) {
		const project = this.#project(target);
		const actor = this.document;
		const data = { ...actor.system.toObject(), counters: effectiveCounters(actor) };
		const missing = Object.entries(getShortfalls(data, project)).map(([key, amount]) => `${amount} ${localize(`Resources.${key}`)}`);
		const free = getWorkers(this.document.system).free;
		if (project.workers > free) {
			missing.push(localize("Project.MissingPeople", { count: project.workers - free }));
		}
		if (missing.length) {
			const confirmed = await DialogV2.confirm({
				window: { title: localize("Project.Start") },
				content: `<p>${localize("Project.Shortfall", { missing: foundry.utils.escapeHTML(missing.join(", ")) })}</p>`
			});
			if (!confirmed) {
				return;
			}
		}
		const started = startProject(data, project.id);
		const changes = { "system.projects": started.projects };
		for (const key of COSTS) {
			changes[`system.counters.${key}.value`] = storedCounterValue(actor, key, started.counters[key].value);
		}
		await actor.update(changes);
	}

	static async #onPauseProject(event, target) {
		await this.#updateProject(this.#project(target).id, { status: "paused" });
	}

	static async #onResumeProject(event, target) {
		await this.#updateProject(this.#project(target).id, { status: "active" });
	}

	static async #onUnlockProject(event, target) {
		await this.#updateProject(this.#project(target).id, { status: "available" });
	}

	static async #onReopenProject(event, target) {
		await this.#updateProject(this.#project(target).id, { status: "available", progress: 0 });
	}

	/** Sets a lasting project up as built and running, without paying its cost or waiting its days. */
	static async #onBuildProject(event, target) {
		const project = this.#project(target);
		await this.#updateProject(project.id, { status: "active", progress: project.days });
	}

	static async #onAddGroup(event, target) {
		const guard = target.dataset.guard === "true";
		const groups = this.document.system.toObject().groups;
		groups.push(newGroup(guard, localize(guard ? "Groups.NewGuards" : "Groups.NewResidents")));
		await this.document.update({ "system.groups": groups });
	}

	static async #onDeleteGroup(event, target) {
		const id = target.closest("[data-group-id]").dataset.groupId;
		const groups = this.document.system.toObject().groups;
		const group = groups.find(entry => entry.id === id);
		const confirmed = event.shiftKey || !group.count || await DialogV2.confirm({
			window: { title: localize("DeleteTitle") },
			content: `<p>${localize("DeleteConfirm", { name: foundry.utils.escapeHTML(group.name) })}</p>`
		});
		if (confirmed) {
			await this.document.update({ "system.groups": groups.filter(entry => entry.id !== id) });
		}
	}

	/** Copies a project into other cities; each copy has not started and links to none of this city's projects. */
	static async #onCopyProject(event, target) {
		const project = this.#project(target);
		const others = game.actors.filter(actor => actor.type === CITY_TYPE && actor !== this.document).sort((a, b) => a.name.localeCompare(b.name));
		if (!others.length) {
			ui.notifications.warn(localize("Project.NoCities"));
			return;
		}
		const rows = others.map(other => `<label class="mist-eco-row"><span class="name">${foundry.utils.escapeHTML(other.name)}</span><input type="checkbox" name="city" value="${other.uuid}"></label>`).join("");
		const chosen = await DialogV2.prompt({
			window: { title: localize("Project.CopyTitle", { name: project.name }), icon: "fa-solid fa-copy" },
			content: `<p class="hint">${localize("Project.CopyHint")}</p><div class="mist-eco-rows">${rows}</div>`,
			ok: { label: localize("Project.Copy"), callback: (event, button) => [...button.form.querySelectorAll("input[name='city']:checked")].map(input => input.value) }
		});
		const cities = others.filter(other => chosen?.includes(other.uuid));
		const source = this.document.system.toObject().projects.find(entry => entry.id === project.id);
		for (const city of cities) {
			const copy = { ...structuredClone(source), id: foundry.utils.randomID(), status: source.status === "locked" ? "locked" : "available", progress: 0, unlocks: [] };
			await city.update({ "system.projects": [...city.system.toObject().projects, copy] });
		}
		if (cities.length) {
			ui.notifications.info(localize("Project.Copied", { name: project.name, cities: cities.map(city => city.name).join(", ") }));
		}
	}
}
