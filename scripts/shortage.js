import { localize } from "./city-sheet.js";
import { MODULE_ID, NEEDS, SHORTAGE_ICON } from "./constants.js";
import { effectiveCounters } from "./hierarchy.js";
import { getShortages } from "./logic.js";

// A city with less Supplies or Materials than it needs gets a shortage feature with a debuff for each; it goes away
// once the city has enough.

const FLAG = "shortage";

/** The setting holding the feature a city short of this counter gets. */
function setting(key) {
	return `${key}ShortageFeature`;
}

function shortageItems(city, key) {
	return city.items.filter(item => item.getFlag(MODULE_ID, FLAG) === key);
}

/**
 * The feature a city short of a counter gets: a copy of the feature chosen in the module settings, or a plain one whose
 * effect lowers Stability by 1.
 */
async function shortageFeature(key) {
	const uuid = game.settings.get(MODULE_ID, setting(key));
	const original = uuid ? await fromUuid(uuid) : null;
	const name = localize(`Shortage.Name.${key}`);
	const data = original?.type === "feature" ? original.toObject() : {
		name,
		type: "feature",
		img: SHORTAGE_ICON,
		system: { description: `<p>${localize(`Shortage.Description.${key}`)}</p>` },
		effects: [{
			name,
			img: SHORTAGE_ICON,
			system: { changes: [{ key: "system.counters.stability.value", type: "add", value: "-1" }] }
		}]
	};
	delete data._id;
	foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG}`, key);
	foundry.utils.setProperty(data, `flags.${MODULE_ID}.source`, name);
	return data;
}

/** Gives the city a shortage feature for each counter it lacks, or takes it away, as its counters after every effect stand. */
export async function syncShortages(city, { renew = [] } = {}) {
	const shortages = getShortages({ needs: city.system.needs, counters: effectiveCounters(city) });
	for (const key of NEEDS) {
		const short = shortages.includes(key);
		const items = shortageItems(city, key);
		if (items.length && (!short || renew.includes(key))) {
			await city.deleteEmbeddedDocuments("Item", items.map(item => item.id));
		}
		if (short && (!items.length || renew.includes(key))) {
			await city.createEmbeddedDocuments("Item", [await shortageFeature(key)]);
		}
	}
}

/** Called during init; a changed setting asks for that counter's shortage features anew. */
export function registerShortageSettings(renew) {
	for (const key of NEEDS) {
		game.settings.register(MODULE_ID, setting(key), {
			name: `MIST_ECO.Settings.ShortageFeature.Name.${key}`,
			hint: `MIST_ECO.Settings.ShortageFeature.Hint.${key}`,
			scope: "world",
			config: true,
			type: String,
			default: "",
			// Cities already short of this counter take the new feature.
			onChange: () => renew(key)
		});
	}
}
