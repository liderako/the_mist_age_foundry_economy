import { COUNTRY_TYPE, MODULE_ID, ORGANIZATION_KINDS, ORGANIZATION_TYPE, REGION_TYPE } from "./constants.js";
import { FEATURE_ACTIONS, featureGroup } from "./features.js";
import { getOrganizations, organizationAreaRows, organizationCityRows, organizationMembers, organizationParents, organizationPath } from "./influence.js";
import { organizationFamily } from "./logic.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATES = `modules/${MODULE_ID}/templates`;

function localize(key, data) {
	return data ? game.i18n.format(`MIST_ECO.${key}`, data) : game.i18n.localize(`MIST_ECO.${key}`);
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

/**
 * Sheet of an organization: what it is and what it is part of, the organizations that are part of it, its influence on
 * the countries, regions and cities where its projects and theirs run, and its features and effects. Projects name
 * their organization in the project editor of a city.
 */
export class OrganizationSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["mist-eco", "mist-eco-organization"],
		position: { width: 900, height: 760 },
		window: { resizable: true },
		form: { submitOnChange: true },
		actions: {
			openLink: (event, target) => fromUuidSync(target.closest("[data-uuid]").dataset.uuid, { strict: false })?.sheet.render({ force: true }),
			detachMember: OrganizationSheet.#onDetachMember,
			...FEATURE_ACTIONS
		}
	};

	static PARTS = {
		header: { template: `${TEMPLATES}/organization-header.hbs` },
		tabs: { template: "templates/generic/tab-navigation.hbs" },
		overview: { template: `${TEMPLATES}/organization-overview.hbs`, scrollable: [""] },
		features: { template: `${TEMPLATES}/features.hbs`, scrollable: [""] },
		effects: { template: `${TEMPLATES}/effects.hbs`, scrollable: [""] }
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "overview", icon: "fa-solid fa-landmark-flag" },
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
		const cities = organizationCityRows(actor).filter(row => fromUuidSync(row.uuid, { strict: false })?.testUserPermission(game.user, "OBSERVER"));
		const enrich = html => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo: actor, secrets: actor.isOwner });
		const parents = organizationParents();
		// It can be part of any organization but itself and those that are part of it.
		const family = new Set(organizationFamily(actor.uuid, parents));
		const parent = actor.system.parent ? fromUuidSync(actor.system.parent, { strict: false }) : null;
		return Object.assign(context, {
			actor,
			system: actor.system,
			isOrganization: true,
			editable: this.isEditable,
			kinds: ORGANIZATION_KINDS.map(kind => localize(`Organization.Kinds.${kind}`)),
			parent: parent && { uuid: parent.uuid, name: parent.name },
			parentOptions: [
				{ value: "", label: localize("Organization.ParentNone"), selected: !actor.system.parent },
				...getOrganizations().filter(other => !family.has(other.uuid))
					.map(other => ({ value: other.uuid, label: organizationPath(other, parents), selected: other.uuid === actor.system.parent }))
					.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
			],
			members: organizationMembers(actor).map(member => ({ uuid: member.uuid, name: member.name, img: member.img, kind: member.system.kind })),
			cities,
			// Its influence on whole countries and regions: its share of the running projects of all their cities.
			areas: [
				{ title: localize("Influence.Countries"), rows: organizationAreaRows(actor, COUNTRY_TYPE) },
				{ title: localize("Influence.Regions"), rows: organizationAreaRows(actor, REGION_TYPE) }
			],
			totals: {
				cities: cities.length,
				projects: sum(cities.map(row => row.projects)),
				building: sum(cities.map(row => row.building)),
				strong: cities.filter(row => ["strong", "dominant"].includes(row.level)).length
			},
			featureGroups: [await featureGroup(actor, { editable: this.isEditable })],
			enrichedDescription: await enrich(actor.system.description)
		});
	}

	async _preparePartContext(partId, context, options) {
		context = await super._preparePartContext(partId, context, options);
		if (partId in context.tabs) {
			context.tab = context.tabs[partId];
		}
		return context;
	}

	async _onDropItem(event, item) {
		return item.type === "feature" ? super._onDropItem(event, item) : null;
	}

	/** An organization dropped on the sheet becomes part of this one, unless this one is part of it. */
	async _onDropActor(event, actor) {
		if (!this.isEditable || actor.type !== ORGANIZATION_TYPE || actor === this.document) {
			return null;
		}
		if (organizationFamily(actor.uuid, organizationParents()).includes(this.document.uuid)) {
			ui.notifications.warn(localize("Organization.Cycle", { name: actor.name, parent: this.document.name }));
			return null;
		}
		await actor.update({ "system.parent": this.document.uuid });
		return actor;
	}

	static async #onDetachMember(event, target) {
		const member = fromUuidSync(target.closest("[data-uuid]").dataset.uuid, { strict: false });
		await member?.update({ "system.parent": "" });
	}
}
