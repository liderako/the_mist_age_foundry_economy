import { CITY_TYPE, COUNTRY_TYPE, MODULE_ID, REGION_TYPE } from "./constants.js";
import { settleCity } from "./days.js";
import { syncProjectFeatures } from "./project-features.js";
import { registerShortageSettings, syncShortages } from "./shortage.js";

// Features that follow a city's state: those its running projects hold, and shortage debuffs. The active GM keeps every
// city in step whenever a city, region or country, or one of their features or effects, changes.

const TYPES = [CITY_TYPE, REGION_TYPE, COUNTRY_TYPE];

// Checks are applied one after another, so two changes at once never give a city the same feature twice.
let queue = Promise.resolve();

function syncAll(options = {}) {
	if (!game.users.activeGM?.isSelf) {
		return;
	}
	queue = queue.then(async () => {
		for (const city of game.actors.filter(actor => actor.type === CITY_TYPE)) {
			// One-time projects with no days left complete now; then running projects, whose features change the counters
			// the shortages are checked against.
			await settleCity(city);
			await syncProjectFeatures(city, options);
			await syncShortages(city, options);
		}
	}).catch(error => console.error(`${MODULE_ID} | sync`, error));
}

/** Called during init. */
export function registerSync() {
	registerShortageSettings(key => syncAll({ renew: [key] }));
	const sync = foundry.utils.debounce(() => syncAll(), 200);
	const onActor = actor => {
		if (TYPES.includes(actor?.type)) {
			sync();
		}
	};
	for (const hook of ["createActor", "updateActor", "deleteActor"]) {
		Hooks.on(hook, onActor);
	}
	// A feature item of the world changed in its own sheet: the copies running projects hold are made anew.
	const refresh = new Set();
	const renew = foundry.utils.debounce(() => {
		const uuids = [...refresh];
		refresh.clear();
		syncAll({ refresh: uuids });
	}, 200);
	const onWorldItem = item => {
		if (item?.documentName === "Item" && !item.parent && !item.pack && item.type === "feature") {
			refresh.add(item.uuid);
			renew();
		}
	};
	for (const hook of ["updateItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
		Hooks.on(hook, document => onWorldItem(document.documentName === "Item" ? document : document.parent));
	}
	for (const hook of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
		Hooks.on(hook, document => onActor(document.parent?.documentName === "Actor" ? document.parent : document.parent?.parent));
	}
	Hooks.once("ready", () => syncAll());
}
