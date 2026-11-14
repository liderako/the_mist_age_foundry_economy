import { CITY_TYPE, COUNTERS, COUNTRY_TYPE, MODULE_ID, NEEDS, ORGANIZATION_TYPE, REGION_TYPE } from "./constants.js";
import { getOrganizations } from "./influence.js";

// The effect editor of Daggerheart suggests the keys an effect can change, as it does for characters and adversaries.
// The economy adds its own: a city's counters and needs, the influence of each organization in it, the bonuses a region
// or country gives every city inside. An
// effect on an economy actor, or on a feature it holds, is offered only these; one on a character never sees them. The
// editor also gets a part for what the effect adds to organizations' influence in a city.

const ECONOMY_TYPES = [CITY_TYPE, REGION_TYPE, COUNTRY_TYPE, ORGANIZATION_TYPE];
const KEY = /^system\.(?:counters|needs|bonuses|influence)(?:\.|$)/;

function localize(key, data) {
	return data ? game.i18n.format(`MIST_ECO.${key}`, data) : game.i18n.localize(`MIST_ECO.${key}`);
}

/**
 * The keys of the economy, grouped as the autocomplete shows them. The autocomplete searches labels only, so each label
 * ends with its key: typing "Supplies" or "system.counters" both find it.
 */
function economyChoices() {
	const resource = key => localize(`Resources.${key}`);
	const city = localize("EffectKeys.City");
	const area = localize("EffectKeys.Area");
	const withKey = choice => ({ ...choice, label: `${choice.label} — ${choice.value}` });
	return [
		...COUNTERS.flatMap(key => [
			{ value: `system.counters.${key}.value`, label: localize("EffectKeys.Value", { name: resource(key) }), hint: localize("EffectKeys.ValueHint"), group: city },
			{ value: `system.counters.${key}.max`, label: localize("EffectKeys.Max", { name: resource(key) }), hint: localize("EffectKeys.MaxHint"), group: city }
		]),
		...NEEDS.map(key => ({ value: `system.needs.${key}`, label: localize("EffectKeys.Need", { name: resource(key) }), hint: localize("EffectKeys.NeedHint"), group: city })),
		...COUNTERS.flatMap(key => [
			{ value: `system.bonuses.${key}.value`, label: localize("EffectKeys.BonusValue", { name: resource(key) }), hint: localize("EffectKeys.BonusHint"), group: area },
			{ value: `system.bonuses.${key}.max`, label: localize("EffectKeys.BonusMax", { name: resource(key) }), hint: localize("EffectKeys.BonusHint"), group: area }
		])
	].map(withKey);
}

/**
 * A key for each organization: what the effect adds to its influence in the city. And the organization's own: on its
 * sheet, what the effect adds to its influence in every city where it has running projects.
 */
function influenceChoices() {
	const group = localize("EffectKeys.InfluenceGroup");
	const own = { value: "system.influence", label: `${localize("EffectKeys.OwnInfluence")} — system.influence`, hint: localize("EffectKeys.OwnInfluenceHint"), group: localize("EffectKeys.OrganizationGroup"), isFullPath: true };
	return [own, ...getOrganizations().map(organization => {
		const value = `system.influence.${organization.id}`;
		return { value, label: `${localize("EffectKeys.InfluenceOf", { name: organization.name })} — ${value}`, hint: localize("EffectKeys.InfluenceKeyHint"), group, isFullPath: true };
	})];
}

/** Puts the organizations' keys into the suggestions anew: organizations come, go and change their names. */
function refreshInfluenceChoices() {
	const paths = CONFIG.DH?.ACTOR?.activeEffectExtraPaths?.allActors;
	if (!paths) {
		return;
	}
	const kept = paths.filter(choice => !String(choice.value).startsWith("system.influence"));
	paths.splice(0, paths.length, ...kept, ...influenceChoices());
}

/** The actor an effect works on: its own, or the one holding the item it is on; null for a feature of the world. */
function effectActor(effect) {
	const parent = effect.parent;
	return parent?.documentName === "Actor" ? parent : parent?.parent?.documentName === "Actor" ? parent.parent : null;
}

/**
 * Leaves only the keys that fit the actor the effect works on: a city its counters, needs and the influence of
 * organizations in it; a region or country the bonuses for every city; an organization its own influence. The list is
 * changed in place, as the autocomplete holds it.
 */
function fitChoices(app) {
	const choices = app.changeChoices;
	if (!Array.isArray(choices)) {
		return;
	}
	const actor = effectActor(app.document);
	const ours = choice => KEY.test(choice.value);
	let kept = choices;
	if (actor && ECONOMY_TYPES.includes(actor.type)) {
		const prefix = { [CITY_TYPE]: /^system\.(?:counters|needs|influence)\./, [REGION_TYPE]: /^system\.bonuses\./, [COUNTRY_TYPE]: /^system\.bonuses\./, [ORGANIZATION_TYPE]: /^system\.influence$/ }[actor.type];
		kept = choices.filter(choice => ours(choice) && prefix.test(choice.value));
	} else if (actor) {
		kept = choices.filter(choice => !ours(choice));
	}
	if (kept !== choices) {
		choices.splice(0, choices.length, ...kept);
	}
}

/** What the effect adds to organizations' influence in a city: rows of an organization and an amount. */
function influenceRows(effect) {
	const rows = effect.getFlag(MODULE_ID, "influence");
	return Array.isArray(rows) ? rows : [];
}

async function saveInfluence(effect, rows) {
	await effect.setFlag(MODULE_ID, "influence", rows.filter(row => row.organization));
}

/** Adds the influence part to the details tab: only for effects that can work on a city (a city's, or a feature of the world). */
function renderInfluence(app, element) {
	const effect = app.document;
	const actor = effectActor(effect);
	if (actor && actor.type !== CITY_TYPE) {
		return;
	}
	const details = element.querySelector('section.tab[data-tab="details"]');
	if (!details || details.querySelector(".mist-eco-influence-effect")) {
		return;
	}
	const editable = app.isEditable;
	const organizations = getOrganizations();
	const rows = influenceRows(effect);
	const fieldset = document.createElement("fieldset");
	fieldset.className = "mist-eco-influence-effect";
	const legend = document.createElement("legend");
	legend.textContent = localize("EffectKeys.Influence");
	const hint = document.createElement("p");
	hint.className = "hint";
	hint.textContent = localize("EffectKeys.InfluenceHint");
	fieldset.append(legend, hint);
	rows.forEach((row, index) => {
		const line = document.createElement("div");
		line.className = "form-group";
		const select = document.createElement("select");
		select.disabled = !editable;
		for (const organization of organizations) {
			select.append(new Option(organization.name, organization.uuid, false, organization.uuid === row.organization));
		}
		if (!organizations.some(organization => organization.uuid === row.organization)) {
			select.prepend(new Option(localize("Organization.None"), "", true, true));
		}
		const amount = document.createElement("input");
		amount.type = "number";
		amount.step = "1";
		amount.value = row.amount ?? 0;
		amount.disabled = !editable;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.innerHTML = '<i class="fa-solid fa-trash" inert></i>';
		remove.dataset.tooltip = localize("EffectKeys.RemoveInfluence");
		remove.disabled = !editable;
		const fields = document.createElement("div");
		fields.className = "form-fields";
		fields.append(select, amount, remove);
		line.append(fields);
		fieldset.append(line);
		const update = changes => {
			const next = influenceRows(effect).map(entry => ({ ...entry }));
			Object.assign(next[index], changes);
			saveInfluence(effect, next);
		};
		// The fields have no name, so the effect's form leaves them out: they save on their own.
		select.addEventListener("change", event => {
			event.stopPropagation();
			update({ organization: select.value });
		});
		amount.addEventListener("change", event => {
			event.stopPropagation();
			update({ amount: Math.round(Number(amount.value) || 0) });
		});
		remove.addEventListener("click", () => saveInfluence(effect, influenceRows(effect).filter((_, at) => at !== index)));
	});
	if (editable && organizations.length) {
		const add = document.createElement("button");
		add.type = "button";
		add.innerHTML = `<i class="fa-solid fa-plus" inert></i> ${localize("EffectKeys.AddInfluence")}`;
		add.addEventListener("click", () => saveInfluence(effect, [...influenceRows(effect), { organization: organizations[0].uuid, amount: -1 }]));
		fieldset.append(add);
	}
	details.append(fieldset);
}

/** Called during init. */
export function registerEffectConfig() {
	Hooks.once("i18nInit", () => {
		const paths = CONFIG.DH?.ACTOR?.activeEffectExtraPaths;
		if (paths?.allActors) {
			paths.allActors.push(...economyChoices());
		}
	});
	Hooks.once("ready", refreshInfluenceChoices);
	for (const hook of ["createActor", "updateActor", "deleteActor"]) {
		Hooks.on(hook, actor => {
			if (actor.type === ORGANIZATION_TYPE) {
				refreshInfluenceChoices();
			}
		});
	}
	Hooks.on("renderActiveEffectConfig", (app, element) => {
		fitChoices(app);
		renderInfluence(app, element);
	});
}
