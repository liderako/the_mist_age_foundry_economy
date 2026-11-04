import { MODULE_ID } from "./constants.js";
import { textToHtml } from "./logic.js";

const { DialogV2 } = foundry.applications.api;
const SOURCE_FLAG = `flags.${MODULE_ID}.source`;

// Features of cities, regions and countries are Daggerheart feature items, as on adversaries: a description plus
// active effects that apply to the actor. The actor can also have effects of its own.

function enrich(actor, html) {
	return foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo: actor, secrets: actor.isOwner });
}

function changesText(effect) {
	return (effect.system?.changes ?? effect.changes ?? []).map(change => `${change.key} ${change.type ?? change.mode ?? ""} ${change.value}`.replace(/\s+/g, " ").trim()).join("; ");
}

/** What a features tab shows of an actor's feature items. */
export async function featureViews(actor) {
	return Promise.all(actor.items.filter(item => item.type === "feature").map(async item => ({
		id: item.id,
		name: item.name,
		img: item.img,
		source: foundry.utils.getProperty(item, SOURCE_FLAG) ?? "",
		description: await enrich(actor, item.system.description),
		effects: item.effects.map(effect => ({ name: effect.name, img: effect.img, disabled: effect.disabled }))
	})));
}

/** The actor's own effects, with what they change. */
export function effectViews(actor) {
	return actor.effects.map(effect => ({ id: effect.id, name: effect.name, img: effect.img, disabled: effect.disabled, changes: changesText(effect) }));
}

/** The effects the actor's features bring, with the feature each comes from. */
export function featureEffectViews(actor) {
	return actor.items.filter(item => item.type === "feature").flatMap(item => item.effects.map(effect => ({
		itemId: item.id,
		feature: item.name,
		name: effect.name,
		img: effect.img,
		disabled: effect.disabled,
		changes: changesText(effect)
	})));
}

/** What the features and effects tabs show of one actor. */
export async function featureGroup(actor, { heading = false, editable = actor.isOwner } = {}) {
	return {
		uuid: actor.uuid,
		heading: heading ? actor.name : null,
		img: actor.img,
		editable,
		features: await featureViews(actor),
		effects: effectViews(actor),
		featureEffects: featureEffectViews(actor)
	};
}

/**
 * Adds the features of completed projects to an actor: a copy of the linked feature item, or a plain feature made from
 * the name and description. Each remembers the project it came from.
 */
export async function grantItems(actor, entries) {
	const items = [];
	for (const { grant, source } of entries) {
		const original = grant.uuid ? await fromUuid(grant.uuid) : null;
		const data = original?.type === "feature"
			? original.toObject()
			: { name: grant.name, type: "feature", img: grant.img, system: { description: textToHtml(grant.description) } };
		delete data._id;
		foundry.utils.setProperty(data, SOURCE_FLAG, source);
		items.push(data);
	}
	if (items.length) {
		await actor.createEmbeddedDocuments("Item", items);
	}
}

function owner(target) {
	return fromUuidSync(target.closest("[data-actor-uuid]").dataset.actorUuid, { strict: false });
}

function feature(target) {
	return owner(target)?.items.get(target.closest("[data-item-id]").dataset.itemId);
}

function effect(target) {
	return owner(target)?.effects.get(target.closest("[data-effect-id]").dataset.effectId);
}

async function confirmDelete(event, name) {
	return event.shiftKey || DialogV2.confirm({
		window: { title: game.i18n.localize("MIST_ECO.DeleteTitle") },
		content: `<p>${game.i18n.format("MIST_ECO.DeleteConfirm", { name: foundry.utils.escapeHTML(name) })}</p>`
	});
}

/** Sheet actions shared by the city, region and country sheets; the actor is the one of the list clicked. */
export const FEATURE_ACTIONS = {
	async addFeature(event, target) {
		const [item] = await owner(target).createEmbeddedDocuments("Item", [{ name: game.i18n.localize("MIST_ECO.Features.New"), type: "feature" }]);
		item?.sheet.render({ force: true });
	},
	editFeature(event, target) {
		feature(target)?.sheet.render({ force: true });
	},
	async deleteFeature(event, target) {
		const item = feature(target);
		if (item && await confirmDelete(event, item.name)) {
			await item.delete();
		}
	},
	async addEffect(event, target) {
		const actor = owner(target);
		const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [{
			name: game.i18n.localize("MIST_ECO.Effects.New"),
			img: "icons/svg/aura.svg",
			origin: actor.uuid
		}]);
		created?.sheet.render({ force: true });
	},
	editEffect(event, target) {
		effect(target)?.sheet.render({ force: true });
	},
	async toggleEffect(event, target) {
		const found = effect(target);
		await found?.update({ disabled: !found.disabled });
	},
	async deleteEffect(event, target) {
		const found = effect(target);
		if (found && await confirmDelete(event, found.name)) {
			await found.delete();
		}
	}
};
