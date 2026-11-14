import { MODULE_ID } from "./constants.js";
import { isResourceChange, readResources, resourceChanges } from "./logic.js";

// The resources a feature gives and needs live in one effect of the feature item, named after them ("Supplies +1"), so
// opening the feature shows what it gives. The project editor writes that effect; the feature's own sheet can change it.

const FLAG = "resources";

function changesOf(effect) {
	return effect.system?.changes ?? effect.changes ?? [];
}

/** What a feature gives and needs, summed over its enabled effects. */
export function featureResources(item) {
	return readResources((item?.effects ?? []).filter(effect => !effect.disabled).flatMap(changesOf));
}

/** "Supplies +1, Materials +1; needs Materials 1", or "" when the feature gives and needs nothing. */
export function resourceText({ gives, needs }) {
	const label = key => game.i18n.localize(`MIST_ECO.Resources.${key}`);
	const signed = amount => (amount > 0 ? `+${amount}` : `${amount}`);
	const given = Object.entries(gives).filter(([, amount]) => amount).map(([key, amount]) => `${label(key)} ${signed(amount)}`).join(", ");
	const needed = Object.entries(needs).filter(([, amount]) => amount).map(([key, amount]) => `${label(key)} ${amount}`).join(", ");
	return [given, needed && game.i18n.format("MIST_ECO.Resources.NeedsText", { needs: needed })].filter(Boolean).join("; ");
}

/** The effect holding the feature's resources: the one marked so, or else the first whose changes are all resources. */
function resourceEffect(item) {
	return item.effects.find(effect => effect.getFlag(MODULE_ID, FLAG))
		?? item.effects.find(effect => changesOf(effect).length && changesOf(effect).every(isResourceChange));
}

/** True when the module may write the feature's resources: a feature item of the world, not of a compendium or actor. */
export function canWriteResources(item) {
	return item?.type === "feature" && !item.pack && !item.parent && item.isOwner;
}

/**
 * Writes what the feature gives and needs into its resource effect, keeping the effect's other changes. A feature for a
 * region or country ("area") gives its resources to every city inside, as bonuses; it has no needs.
 */
export async function writeResources(item, resources, scope = "city") {
	const effect = resourceEffect(item);
	if (scope === "area") {
		resources = { gives: resources.gives, needs: {} };
	}
	const name = resourceText(resources) || game.i18n.localize("MIST_ECO.Resources.None");
	const changes = [...(effect ? changesOf(effect).filter(change => !isResourceChange(change)) : []), ...resourceChanges(resources, scope)];
	if (!effect) {
		if (changes.length) {
			await item.createEmbeddedDocuments("ActiveEffect", [{ name, img: item.img, system: { changes }, flags: { [MODULE_ID]: { [FLAG]: true } } }]);
		}
		return;
	}
	await effect.update({ name, "system.changes": changes, [`flags.${MODULE_ID}.${FLAG}`]: true });
}
