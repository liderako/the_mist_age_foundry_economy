import { COSTS, COUNTERS, MODULE_ID, NEEDS, PROJECT_KINDS, PROJECT_STATUSES } from "./constants.js";
import { getOrganizations, organizationPath } from "./influence.js";
import { textToHtml } from "./logic.js";
import { canWriteResources, featureResources, writeResources } from "./resources.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Editor of one project of a city; also creates a project when no id is given. */
export class ProjectConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(actor, projectId = null, options = {}) {
		super(options);
		this.actor = actor;
		const source = actor.system.toObject().projects.find(project => project.id === projectId);
		// The project being edited. Features and their resources changed here stay here until the form is saved.
		this.project = source ?? {
			...actor.system.schema.getField("projects").element.getInitialValue(),
			name: game.i18n.localize("MIST_ECO.Project.New")
		};
		this.isNew = !source;
	}

	static DEFAULT_OPTIONS = {
		tag: "form",
		classes: ["mist-eco-project-config"],
		window: { icon: "fa-solid fa-hammer", resizable: true, contentClasses: ["standard-form"] },
		position: { width: 640, height: 760 },
		form: { handler: ProjectConfig.#onSubmit, closeOnSubmit: true },
		actions: {
			addResource: ProjectConfig.#onAddResource,
			removeResource: ProjectConfig.#onRemoveResource,
			addGrant: ProjectConfig.#onAddGrant,
			removeGrant: ProjectConfig.#onRemoveGrant,
			unlinkGrant: ProjectConfig.#onUnlinkGrant
		}
	};

	static PARTS = {
		form: { template: `modules/${MODULE_ID}/templates/project-config.hbs`, scrollable: [""] },
		footer: { template: "templates/generic/form-footer.hbs" }
	};

	get title() {
		return `${game.i18n.localize("MIST_ECO.Project.Title")}: ${this.project.name}`;
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const project = this.project;
		const resourceLabel = key => game.i18n.localize(`MIST_ECO.Resources.${key}`);
		await this.#loadResources();
		const rows = (list, keys) => list.map((row, index) => ({ ...row, index, keys: keys.map(key => ({ value: key, label: resourceLabel(key), selected: key === row.key })) }));
		return Object.assign(context, {
			project,
			statuses: PROJECT_STATUSES.map(status => ({ value: status, label: game.i18n.localize(`MIST_ECO.Status.${status}`), selected: status === project.status })),
			kinds: PROJECT_KINDS.map(kind => ({ value: kind, label: game.i18n.localize(`MIST_ECO.Project.Kind.${kind}`), selected: kind === project.kind })),
			organizations: [
				{ value: "", label: game.i18n.localize("MIST_ECO.Organization.None"), selected: !project.organization },
				...getOrganizations().map(organization => ({ value: organization.uuid, label: organizationPath(organization), selected: organization.uuid === project.organization }))
					.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
			],
			allies: getOrganizations().map(organization => ({ value: organization.uuid, label: organizationPath(organization), selected: (project.allies ?? []).includes(organization.uuid) }))
				.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
			costs: COSTS.map(key => ({ key, label: resourceLabel(key), value: project.cost[key] })),
			grants: (project.grants ?? []).map((grant, index) => ({
				...grant,
				index,
				linked: Boolean(grant.uuid),
				gives: rows(grant.resources.gives, COUNTERS),
				needs: rows(grant.resources.needs, NEEDS),
				targets: ["city", "region", "country"].map(value => ({ value, label: game.i18n.localize(`MIST_ECO.Features.Target.${value}`), selected: value === grant.target }))
			})),
			others: this.actor.system.projects.filter(other => other.id !== project.id).map(other => ({
				id: other.id,
				name: other.name,
				status: game.i18n.localize(`MIST_ECO.Status.${other.status}`),
				checked: project.unlocks.includes(other.id)
			})),
			enrichedDescription: await foundry.applications.ux.TextEditor.implementation.enrichHTML(project.description, { relativeTo: this.actor }),
			buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: this.isNew ? "MIST_ECO.Project.Create" : "MIST_ECO.Project.Save" }]
		});
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		// A Daggerheart feature dropped on the features section is granted as it is, effects included.
		const grants = this.element.querySelector(".mist-eco-grants");
		grants?.addEventListener("dragover", event => event.preventDefault());
		grants?.addEventListener("drop", event => this.#onDropGrant(event));
	}

	/**
	 * Reads what each feature gives and needs from its item, once: those rows are edited here and written back to the
	 * item when the project is saved. A feature not made yet starts with none; one the module may not write stays read-only.
	 */
	async #loadResources() {
		const toRows = amounts => Object.entries(amounts).map(([key, amount]) => ({ key, amount }));
		for (const grant of this.project.grants) {
			if (grant.resources) {
				continue;
			}
			const item = grant.uuid ? await fromUuid(grant.uuid) : null;
			const { gives, needs } = featureResources(item);
			grant.resources = { gives: toRows(gives), needs: toRows(needs) };
			// Whom it goes to matters too: a city's resources and a region's or country's bonuses are different keys.
			grant.loaded = JSON.stringify([grant.resources, grant.target]);
			grant.editable = !item || canWriteResources(item);
		}
	}

	/** Reads the form into the project being edited. */
	#readForm() {
		const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
		const project = this.project;
		const img = data.img || project.img;
		const number = (value, fallback = 0) => (value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback);
		Object.assign(project, {
			name: data.name?.trim() || project.name,
			img,
			status: data.status,
			days: Math.max(0, Math.round(number(data.days))),
			progress: Math.max(0, Math.round(number(data.progress))),
			kind: PROJECT_KINDS.includes(data.kind) ? data.kind : project.kind,
			organization: data.organization ?? project.organization ?? "",
			influence: Math.max(0, Math.round(number(data.influence, 1))),
			// A select of several: one value comes as a string, none as nothing.
			allies: [data.allies ?? []].flat().filter(uuid => uuid && uuid !== (data.organization ?? project.organization)),
			workers: Math.max(0, Math.round(number(data.workers))),
			description: data.description ?? project.description,
			cost: Object.fromEntries(COSTS.map(key => [key, Math.max(0, Math.round(number(data.cost?.[key])))])),
			unlocks: Object.entries(data.unlocks ?? {}).filter(([, checked]) => checked).map(([id]) => id),
			grants: Object.entries(data.grants ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([index, grant]) => {
				const previous = project.grants[Number(index)] ?? {};
				const rows = (entries, keys) => Object.entries(entries ?? {}).sort(([a], [b]) => Number(a) - Number(b))
					.map(([, row]) => ({ key: row.key, amount: Math.round(number(row.amount)) }))
					.filter(row => keys.includes(row.key));
				return {
					uuid: grant.uuid ?? "",
					name: grant.name?.trim() || game.i18n.localize("MIST_ECO.Features.New"),
					img: grant.img || img,
					description: grant.description ?? "",
					target: ["city", "region", "country"].includes(grant.target) ? grant.target : "city",
					// Rows of a read-only feature are not in the form; they stay as read.
					resources: previous.editable === false ? previous.resources : { gives: rows(grant.gives, COUNTERS), needs: rows(grant.needs, NEEDS) },
					loaded: previous.loaded,
					editable: previous.editable
				};
			})
		});
	}

	/** Adds a row of what a feature gives (Supplies +1) or needs (Materials 1). */
	static async #onAddResource(event, target) {
		this.#readForm();
		const { index, list } = target.dataset;
		this.project.grants[Number(index)].resources[list].push({ key: list === "gives" ? "supplies" : "materials", amount: 1 });
		this.render();
	}

	static async #onRemoveResource(event, target) {
		this.#readForm();
		const { index, list, row } = target.dataset;
		this.project.grants[Number(index)].resources[list].splice(Number(row), 1);
		this.render();
	}

	/** A new feature to grant takes the project's own image. */
	static async #onAddGrant() {
		this.#readForm();
		(this.project.grants ??= []).push({ uuid: "", name: game.i18n.localize("MIST_ECO.Features.New"), img: this.project.img, description: "", target: "city" });
		this.render();
	}

	async #onDropGrant(event) {
		event.preventDefault();
		const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
		const item = data?.type === "Item" ? await fromUuid(data.uuid) : null;
		if (item?.type !== "feature") {
			return;
		}
		this.#readForm();
		(this.project.grants ??= []).push({ uuid: item.uuid, name: item.name, img: item.img, description: "", target: "city" });
		this.render();
	}

	/** Keeps the name, image and resources but stops copying the item: saving makes a feature item of its own. */
	static async #onUnlinkGrant(event, target) {
		this.#readForm();
		Object.assign(this.project.grants[Number(target.dataset.index)], { uuid: "", editable: true });
		this.render();
	}

	static async #onRemoveGrant(event, target) {
		this.#readForm();
		this.project.grants.splice(Number(target.dataset.index), 1);
		this.render();
	}

	/**
	 * Saves the project. A feature made here becomes a feature item of the world; what each feature gives and needs is
	 * written into its item, so the feature itself shows its resources and every city running the project gets them.
	 */
	static async #onSubmit() {
		this.#readForm();
		const sum = list => list.reduce((amounts, row) => ({ ...amounts, [row.key]: (amounts[row.key] ?? 0) + row.amount }), {});
		for (const grant of this.project.grants) {
			const made = !grant.uuid;
			if (made) {
				const item = await Item.implementation.create({ name: grant.name, type: "feature", img: grant.img, system: { description: textToHtml(grant.description) } });
				grant.uuid = item.uuid;
			}
			const item = await fromUuid(grant.uuid);
			if (canWriteResources(item) && (made || JSON.stringify([grant.resources, grant.target]) !== grant.loaded)) {
				// A feature for a region or country gives its resources to every city inside.
				await writeResources(item, { gives: sum(grant.resources.gives), needs: sum(grant.resources.needs) }, grant.target === "city" ? "city" : "area");
			}
		}
		this.project.grants = this.project.grants.map(({ uuid, name, img, description, target }) => ({ uuid, name, img, description, target }));
		const data = this.actor.system.toObject();
		const index = data.projects.findIndex(project => project.id === this.project.id);
		if (index >= 0) {
			data.projects[index] = this.project;
		} else {
			data.projects.push(this.project);
		}
		await this.actor.update({ "system.projects": data.projects });
	}
}
