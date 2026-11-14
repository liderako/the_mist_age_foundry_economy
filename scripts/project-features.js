import { CITY_TYPE, COUNTRY_TYPE, MODULE_ID, REGION_TYPE } from "./constants.js";
import { grantItems } from "./features.js";
import { getCountry, getRegion } from "./hierarchy.js";
import { holdsFeatures } from "./logic.js";

// A running project (a repeating one while active, a lasting one once built) holds its features, on the city or its
// region or country as each says; paused, deleted or no longer running, it takes them back. Each such feature is marked
// "<city id>.<project id>.<index>".

const FLAG = "held";
const TYPES = [CITY_TYPE, REGION_TYPE, COUNTRY_TYPE];

/**
 * Gives and takes back the features the city's projects hold, so they match the projects as they stand. Copies of the
 * feature items asked to be refreshed (changed in their own sheet) are made anew.
 */
export async function syncProjectFeatures(city, { refresh = [] } = {}) {
	const holders = { city, region: getRegion(city) ?? city, country: getCountry(city) ?? getRegion(city) ?? city };
	const wanted = new Map();
	for (const project of city.system.projects.filter(holdsFeatures)) {
		project.grants.forEach((grant, index) => {
			const holder = holders[grant.target];
			if (!wanted.has(holder)) {
				wanted.set(holder, []);
			}
			wanted.get(holder).push({ grant, source: project.name, mark: `${city.id}.${project.id}.${index}` });
		});
	}
	// Features this city's projects left anywhere, also on a region or country the city has since left.
	const prefix = `${city.id}.`;
	const marked = actor => actor.items.filter(item => String(item.getFlag(MODULE_ID, FLAG) ?? "").startsWith(prefix));
	const actors = new Set([...wanted.keys(), ...game.actors.filter(actor => TYPES.includes(actor.type) && marked(actor).length)]);
	for (const actor of actors) {
		const entries = wanted.get(actor) ?? [];
		const marks = new Set(entries.map(entry => entry.mark));
		const renewed = new Set(entries.filter(entry => entry.grant.uuid && refresh.includes(entry.grant.uuid)).map(entry => entry.mark));
		const items = marked(actor);
		const stale = items.filter(item => !marks.has(item.getFlag(MODULE_ID, FLAG)) || renewed.has(item.getFlag(MODULE_ID, FLAG)));
		if (stale.length) {
			await actor.deleteEmbeddedDocuments("Item", stale.map(item => item.id));
		}
		const held = new Set(items.filter(item => !stale.includes(item)).map(item => item.getFlag(MODULE_ID, FLAG)));
		await grantItems(actor, entries.filter(entry => !held.has(entry.mark)));
	}
}
