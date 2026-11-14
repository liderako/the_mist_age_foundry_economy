import { CITY_TYPE, COUNTRY_TYPE, MODULE_ID, ORGANIZATION_TYPE, REGION_TYPE } from "./constants.js";
import { getCities, getCountry, getCountryCities, getRegion, placeLabel } from "./hierarchy.js";
import { backs, cityInfluence, influenceModifiers, isEstablished, organizationAncestors, organizationFamily, projectOrganizations } from "./logic.js";

// What the sheets show of organizations: their influence on a city, a region or a country, and the cities, regions and
// countries of an organization. Influence on a region or country is the organization's share of the running projects
// of all its cities. An organization's projects are its own and those of the organizations that are part of it, at any
// depth: the Crown's are those of its city guards and of its legions.

const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);

function localize(key, data) {
	return data ? game.i18n.format(`MIST_ECO.${key}`, data) : game.i18n.localize(`MIST_ECO.${key}`);
}

/** Every organization of the world, by name. */
export function getOrganizations() {
	return game.actors.filter(actor => actor.type === ORGANIZATION_TYPE).sort(byName);
}

/** Each organization of the world mapped to the one it is part of. */
export function organizationParents() {
	return new Map(getOrganizations().map(organization => [organization.uuid, organization.system.parent]));
}

/** An organization's name with those it is part of: "Корона › (8) Клинки Буревію". */
export function organizationPath(organization, parents = organizationParents()) {
	const names = organizationAncestors(organization.uuid, parents).reverse().map(uuid => fromUuidSync(uuid, { strict: false })?.name).filter(Boolean);
	return [...names, organization.name].join(" › ");
}

/** The organizations directly part of this one, by name. */
export function organizationMembers(organization) {
	return getOrganizations().filter(other => other.system.parent === organization.uuid);
}

/** The cities where an organization or one of its parts has projects, by name. */
export function organizationCities(organization, members = organizationFamily(organization.uuid, organizationParents())) {
	const ours = new Set(members);
	return game.actors.filter(actor => actor.type === CITY_TYPE && actor.system.projects.some(project => backs(project, ours))).sort(byName);
}

/** The cities of a region, or of a country through its regions. */
function areaCities(area) {
	return area.type === COUNTRY_TYPE ? getCountryCities(area) : getCities(area);
}

/**
 * What the enabled effects on a city, its own and its features', add to the influence of organizations there; and what
 * an organization's own effects add to it in every city where it has running projects.
 */
function cityModifiers(city) {
	const effects = [...city.allApplicableEffects()].filter(effect => !effect.disabled).map(effect => ({ influence: effect.getFlag(MODULE_ID, "influence"), changes: effect.system?.changes ?? effect.changes }));
	const modifiers = influenceModifiers(effects);
	for (const uuid of projectOrganizations(city.system.projects.filter(isEstablished))) {
		const own = fromUuidSync(uuid, { strict: false })?.system?.influence ?? 0;
		if (own) {
			modifiers.set(uuid, (modifiers.get(uuid) ?? 0) + own);
		}
	}
	return modifiers;
}

/**
 * Influence over these cities' projects together, as a table row shows it: share in percent and the level's name, and
 * what effects add to it there.
 */
function influenceView(cities, organization, members) {
	const ours = new Set(members);
	const modifier = cities.reduce((total, city) => total + members.reduce((sum, member) => sum + (cityModifiers(city).get(member) ?? 0), 0), 0);
	const influence = cityInfluence(cities.flatMap(city => city.system.projects), organization, members, modifier);
	return {
		...influence,
		modifier: modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : "",
		percent: Math.round(influence.share * 100),
		levelLabel: localize(`Influence.Level.${influence.level}`),
		cities: cities.filter(city => city.system.projects.some(project => backs(project, ours))).length
	};
}

const strongestFirst = (a, b) => b.share - a.share || b.building - a.building || a.name.localeCompare(b.name, game.i18n.lang);

/**
 * The organizations with projects in these cities (a city, or all of a region or country), strongest first: those
 * the projects name, and those they are part of, each counting its parts' projects too.
 */
export function influenceRows(cities) {
	const parents = organizationParents();
	const named = projectOrganizations(cities.flatMap(city => city.system.projects));
	const present = [...new Set(named.flatMap(uuid => [uuid, ...organizationAncestors(uuid, parents)]))];
	// An organization that no longer exists has no row; its projects still count among all the running ones.
	return present.map(uuid => [uuid, fromUuidSync(uuid, { strict: false })]).filter(([, organization]) => organization).map(([uuid, organization]) => {
		const parent = parents.get(uuid) ? fromUuidSync(parents.get(uuid), { strict: false }) : null;
		return {
			uuid,
			name: organization.name,
			img: organization.img,
			kind: organization.system.kind ?? "",
			parentName: parent?.name ?? "",
			...influenceView(cities, uuid, organizationFamily(uuid, parents))
		};
	}).sort(strongestFirst);
}

/** An organization's cities, with its influence on each and the projects it and its parts have there. */
export function organizationCityRows(organization) {
	const members = organizationFamily(organization.uuid, organizationParents());
	const ours = new Set(members);
	return organizationCities(organization, members).map(city => ({
		uuid: city.uuid,
		name: city.name,
		img: city.img,
		place: placeLabel(city),
		...influenceView([city], organization.uuid, members),
		projectList: city.system.projects.filter(project => backs(project, ours)).map(project => ({
			name: project.name,
			// A project of one of its parts, or one it only strengthens, names whose it is.
			by: project.organization === organization.uuid ? "" : fromUuidSync(project.organization, { strict: false })?.name ?? "",
			running: isEstablished(project),
			status: localize(`Status.${project.status}`)
		}))
	})).sort(strongestFirst);
}

/** The regions or countries where an organization or its parts have projects, with its influence on each. */
export function organizationAreaRows(organization, type) {
	const members = organizationFamily(organization.uuid, organizationParents());
	const find = type === REGION_TYPE ? getRegion : getCountry;
	const areas = new Map();
	for (const city of organizationCities(organization, members)) {
		const area = find(city);
		if (area) {
			areas.set(area.uuid, area);
		}
	}
	return [...areas.values()].map(area => ({
		uuid: area.uuid,
		name: area.name,
		img: area.img,
		...influenceView(areaCities(area), organization.uuid, members)
	})).sort(strongestFirst);
}
