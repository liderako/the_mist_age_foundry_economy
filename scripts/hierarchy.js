import { CITY_TYPE, COUNTERS, COUNTRY_TYPE, REGION_TYPE } from "./constants.js";

function linked(uuid, type) {
	const actor = uuid ? fromUuidSync(uuid, { strict: false }) : null;
	return actor?.type === type ? actor : null;
}

const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);

/** The region a city belongs to, or null. */
export function getRegion(city) {
	return linked(city?.system?.region, REGION_TYPE);
}

/** The country of a region, or of a city through its region, or null. */
export function getCountry(actor) {
	if (actor?.type === CITY_TYPE) {
		return getCountry(getRegion(actor));
	}
	return linked(actor?.system?.country, COUNTRY_TYPE);
}

export function getCities(region) {
	return game.actors.filter(actor => actor.type === CITY_TYPE && actor.system.region === region.uuid).sort(byName);
}

export function getRegions(country) {
	return game.actors.filter(actor => actor.type === REGION_TYPE && actor.system.country === country.uuid).sort(byName);
}

/** Every city of a country, through its regions. */
export function getCountryCities(country) {
	return getRegions(country).flatMap(getCities);
}

/** "Країна › Регіон": where a city is. */
export function placeLabel(city) {
	return [getCountry(city)?.name, getRegion(city)?.name].filter(Boolean).join(" › ");
}

/**
 * A city's counters as they stand: its own after its effects, plus what the effects of its region and country add to
 * every city inside. The value stays between 0 and the maximum.
 */
export function effectiveCounters(city) {
	const levels = [getRegion(city), getCountry(city)].filter(Boolean).map(actor => actor.system.bonuses);
	return Object.fromEntries(COUNTERS.map(key => {
		const own = city.system.counters[key];
		const max = Math.max(0, own.max + levels.reduce((total, bonus) => total + bonus[key].max, 0));
		const value = Math.max(0, Math.min(max, own.value + levels.reduce((total, bonus) => total + bonus[key].value, 0)));
		return [key, { value, max }];
	}));
}

/**
 * The stored value that makes a counter show the wanted value: what effects of the city, its region and its country add
 * on top of the stored value is taken away again.
 */
export function storedCounterValue(city, key, wanted) {
	const levels = [getRegion(city), getCountry(city)].filter(Boolean).map(actor => actor.system.bonuses);
	const added = (city.system.counters[key].value - city._source.system.counters[key].value) + levels.reduce((total, bonus) => total + bonus[key].value, 0);
	return Math.max(0, Math.round(wanted - added));
}
