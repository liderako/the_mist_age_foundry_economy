import { CITY_TYPE, COUNTERS, COUNTRY_TYPE, DEFAULT_CITY_ICON, DEFAULT_REGION_ICON, ICONS, MODULE_ID, PEOPLE, REGION_TYPE } from "./constants.js";
import { advanceButton, alertText, askDays } from "./days.js";
import { FEATURE_ACTIONS, featureGroup } from "./features.js";
import { effectiveCounters, getCities, getCountry, getCountryCities, getRegions } from "./hierarchy.js";
import { getAlerts } from "./logic.js";
import { currentDate, worldDay } from "./time.js";
import { localize, signed } from "./city-sheet.js";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const TEMPLATES = `modules/${MODULE_ID}/templates`;

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

/** One row of a table of cities: people, counters after every effect, active projects and alerts. */
function cityRow(city) {
	const system = city.system;
	const counters = effectiveCounters(city);
	return {
		uuid: city.uuid,
		name: city.name,
		img: city.img,
		population: system.population,
		guards: system.guards,
		counters: COUNTERS.map(key => counters[key]),
		active: system.projects.filter(project => project.status === "active").length,
		alerts: alertText(getAlerts({ groups: system.groups, projects: system.projects, counters }))
	};
}

/** Sums of city rows: a region or country has no counters of its own, only those of its cities. */
function totals(rows) {
	return {
		population: sum(rows.map(row => row.population)),
		guards: sum(rows.map(row => row.guards)),
		counters: COUNTERS.map((key, index) => ({ value: sum(rows.map(row => row.counters[index].value)), max: sum(rows.map(row => row.counters[index].max)) })),
		active: sum(rows.map(row => row.active))
	};
}

/** What a region or country adds to every city inside: set by hand, and changed by its effects. */
function bonusViews(actor) {
	const source = actor._source.system.bonuses;
	const prepared = actor.system.bonuses;
	return COUNTERS.map(key => ({
		key,
		icon: ICONS[key],
		label: localize(`Resources.${key}`),
		value: source[key].value,
		max: source[key].max,
		effects: [
			prepared[key].value !== source[key].value ? localize("Bonuses.ValueEffects", { value: signed(prepared[key].value) }) : "",
			prepared[key].max !== source[key].max ? localize("Bonuses.MaxEffects", { max: signed(prepared[key].max) }) : ""
		].filter(Boolean).join(", ")
	}));
}

/**
 * Shared sheet of a region or a country: the cities inside with the sums of their counters, what it adds to every city
 * inside, and its features and effects, which change those bonuses.
 */
class TerritorySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["mist-eco", "mist-eco-territory"],
		position: { width: 980, height: 800 },
		window: { resizable: true },
		form: { submitOnChange: true },
		actions: {
			nextDay: () => advanceButton(1),
			passDays: async () => {
				const days = await askDays();
				if (days > 0) {
					await advanceButton(days);
				}
			},
			openLink: (event, target) => fromUuidSync(target.closest("[data-uuid]").dataset.uuid, { strict: false })?.sheet.render({ force: true }),
			createChild: TerritorySheet.#onCreateChild,
			detachChild: TerritorySheet.#onDetachChild,
			...FEATURE_ACTIONS
		}
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "overview", icon: "fa-solid fa-map" },
				{ id: "features", icon: "fa-solid fa-star" },
				{ id: "effects", icon: "fa-solid fa-wand-magic-sparkles" }
			],
			initial: "overview",
			labelPrefix: "MIST_ECO.Tabs"
		}
	};

	/** The actor type a dropped actor or the create button adds below this one, and the field that links it here. */
	get childType() {
		return this.document.type === COUNTRY_TYPE ? REGION_TYPE : CITY_TYPE;
	}

	get childField() {
		return this.document.type === COUNTRY_TYPE ? "country" : "region";
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const actor = this.document;
		const isCountry = actor.type === COUNTRY_TYPE;
		const cities = (isCountry ? getCountryCities(actor) : getCities(actor)).filter(city => city.testUserPermission(game.user, "OBSERVER"));
		const cityRows = cities.map(cityRow);
		const cityTotals = totals(cityRows);
		const regions = isCountry ? getRegions(actor).map(region => {
			const rows = getCities(region).map(cityRow);
			return { uuid: region.uuid, name: region.name, img: region.img, cities: rows.length, ...totals(rows) };
		}) : [];
		const country = isCountry ? null : getCountry(actor);
		const enrich = html => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo: actor, secrets: actor.isOwner });
		const regionName = city => (isCountry ? fromUuidSync(city.system.region, { strict: false })?.name ?? "" : "");
		return Object.assign(context, {
			actor,
			system: actor.system,
			source: actor._source.system,
			isCountry,
			isGM: game.user.isGM,
			editable: this.isEditable,
			date: currentDate(),
			icons: ICONS,
			counterLabels: COUNTERS.map(key => ({ icon: ICONS[key], label: localize(`Resources.${key}`) })),
			peopleLabels: PEOPLE.map(key => ({ icon: ICONS[key], label: localize(`Resources.${key}`) })),
			country: country && { uuid: country.uuid, name: country.name, img: country.img },
			bonuses: bonusViews(actor),
			regions,
			cities: cityRows.map((row, index) => ({ ...row, region: regionName(cities[index]) })),
			totals: cityTotals,
			counterTotals: COUNTERS.map((key, index) => ({ icon: ICONS[key], label: localize(`Resources.${key}`), ...cityTotals.counters[index] })),
			childLabel: localize(isCountry ? "Territory.NewRegion" : "Territory.NewCity"),
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

	/** A city dropped on a region, or a region on a country, joins it; features join the actor itself. */
	async _onDropActor(event, actor) {
		if (!this.isEditable || actor.type !== this.childType) {
			return null;
		}
		await actor.update({ [`system.${this.childField}`]: this.document.uuid });
		return actor;
	}

	async _onDropItem(event, item) {
		return item.type === "feature" ? super._onDropItem(event, item) : null;
	}

	static async #onCreateChild() {
		const isCountry = this.document.type === COUNTRY_TYPE;
		const name = await DialogV2.prompt({
			window: { title: localize(isCountry ? "Territory.NewRegion" : "Territory.NewCity"), icon: isCountry ? "fa-solid fa-map" : "fa-solid fa-city" },
			content: `<div class="form-group"><label>${localize("Territory.Name")}</label><div class="form-fields"><input type="text" name="name" autofocus></div></div>`,
			ok: { label: localize("Territory.Create"), callback: (event, button) => button.form.elements.name.value.trim() }
		});
		if (!name) {
			return;
		}
		const system = { [this.childField]: this.document.uuid };
		if (!isCountry) {
			system.day = worldDay();
		}
		const child = await Actor.implementation.create({
			name,
			type: this.childType,
			img: isCountry ? DEFAULT_REGION_ICON : DEFAULT_CITY_ICON,
			folder: this.document.folder?.id ?? null,
			ownership: foundry.utils.deepClone(this.document.ownership),
			system
		});
		child?.sheet.render({ force: true });
	}

	static async #onDetachChild(event, target) {
		const child = fromUuidSync(target.closest("[data-uuid]").dataset.uuid, { strict: false });
		const confirmed = child && await DialogV2.confirm({
			window: { title: localize("Territory.Detach") },
			content: `<p>${localize("Territory.DetachConfirm", { name: foundry.utils.escapeHTML(child.name), parent: foundry.utils.escapeHTML(this.document.name) })}</p>`
		});
		if (confirmed) {
			await child.update({ [`system.${child.type === CITY_TYPE ? "region" : "country"}`]: "" });
		}
	}
}

export class RegionSheet extends TerritorySheet {
	static PARTS = {
		header: { template: `${TEMPLATES}/territory-header.hbs` },
		tabs: { template: "templates/generic/tab-navigation.hbs" },
		overview: { template: `${TEMPLATES}/territory-overview.hbs`, scrollable: [""] },
		features: { template: `${TEMPLATES}/features.hbs`, scrollable: [""] },
		effects: { template: `${TEMPLATES}/effects.hbs`, scrollable: [""] }
	};
}

export class CountrySheet extends TerritorySheet {
	static PARTS = RegionSheet.PARTS;
}

/** Rerenders open sheets of the economy when cities, regions or countries change, or their features and effects. */
export function registerRefresh() {
	const render = foundry.utils.debounce(() => {
		for (const app of foundry.applications.instances.values()) {
			if (app.rendered && [CITY_TYPE, REGION_TYPE, COUNTRY_TYPE].includes(app.document?.type)) {
				app.render();
			}
		}
	}, 150);
	const onActor = actor => {
		if ([CITY_TYPE, REGION_TYPE, COUNTRY_TYPE].includes(actor?.type)) {
			render();
		}
	};
	for (const hook of ["createActor", "updateActor", "deleteActor"]) {
		Hooks.on(hook, onActor);
	}
	for (const hook of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
		Hooks.on(hook, document => onActor(document.parent?.documentName === "Actor" ? document.parent : document.parent?.parent));
	}
}
