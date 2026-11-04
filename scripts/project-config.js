import { COSTS, COUNTERS, MODULE_ID, PEOPLE, PROJECT_STATUSES } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Editor of one project of a city; also creates a project when no id is given. */
export class ProjectConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(actor, projectId = null, options = {}) {
		super(options);
		this.actor = actor;
		const source = actor.system.toObject().projects.find(project => project.id === projectId);
		// The project being edited. Rewards added or removed stay here until the form is saved.
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
			addReward: ProjectConfig.#onAddReward,
			removeReward: ProjectConfig.#onRemoveReward,
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
		const targets = [...COUNTERS, ...PEOPLE].map(key => ({ value: key, label: resourceLabel(key) }));
		return Object.assign(context, {
			project,
			statuses: PROJECT_STATUSES.map(status => ({ value: status, label: game.i18n.localize(`MIST_ECO.Status.${status}`), selected: status === project.status })),
			costs: COSTS.map(key => ({ key, label: resourceLabel(key), value: project.cost[key] })),
			rewards: project.rewards.map((reward, index) => ({
				...reward,
				index,
				chancePercent: Math.round(reward.chance * 100),
				targets: targets.map(target => ({ ...target, selected: target.value === reward.target }))
			})),
			grants: (project.grants ?? []).map((grant, index) => ({
				...grant,
				index,
				linked: Boolean(grant.uuid),
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
		// A fixed reward shows its amount, a range reward its bounds.
		for (const select of this.element.querySelectorAll("select[data-reward-mode]")) {
			select.addEventListener("change", () => {
				select.closest(".mist-eco-reward").dataset.mode = select.value;
			});
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
			repeat: Boolean(data.repeat),
			workers: Math.max(0, Math.round(number(data.workers))),
			description: data.description ?? project.description,
			cost: Object.fromEntries(COSTS.map(key => [key, Math.max(0, Math.round(number(data.cost?.[key])))])),
			rewards: Object.entries(data.rewards ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([, reward]) => ({
				target: reward.target,
				mode: reward.mode,
				amount: number(reward.amount),
				min: number(reward.min),
				max: number(reward.max),
				whole: Boolean(reward.whole),
				chance: Math.min(1, Math.max(0, number(reward.chance, 100) / 100))
			})),
			unlocks: Object.entries(data.unlocks ?? {}).filter(([, checked]) => checked).map(([id]) => id),
			grants: Object.entries(data.grants ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([, grant]) => ({
				uuid: grant.uuid ?? "",
				name: grant.name?.trim() || game.i18n.localize("MIST_ECO.Features.New"),
				img: grant.img || img,
				description: grant.description ?? "",
				target: ["city", "region", "country"].includes(grant.target) ? grant.target : "city"
			}))
		});
	}

	static async #onAddReward() {
		this.#readForm();
		this.project.rewards.push({ target: "supplies", mode: "fixed", amount: 1, min: 0, max: 0, whole: true, chance: 1 });
		this.render();
	}

	static async #onRemoveReward(event, target) {
		this.#readForm();
		this.project.rewards.splice(Number(target.dataset.index), 1);
		this.render();
	}

	/** A new feature to grant takes the project's own image. */
	static async #onAddGrant() {
		this.#readForm();
		(this.project.grants ??= []).push({ name: game.i18n.localize("MIST_ECO.Features.New"), img: this.project.img, description: "", target: "city" });
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

	/** Keeps the name and image but stops copying the item, so the feature is made from the text instead. */
	static async #onUnlinkGrant(event, target) {
		this.#readForm();
		this.project.grants[Number(target.dataset.index)].uuid = "";
		this.render();
	}

	static async #onRemoveGrant(event, target) {
		this.#readForm();
		this.project.grants.splice(Number(target.dataset.index), 1);
		this.render();
	}

	static async #onSubmit() {
		this.#readForm();
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
