export const MODULE_ID = "mist-age-economy";
// The actor sub-types this module adds, nested country → region → city. Module sub-types carry the module id.
export const CITY_TYPE = `${MODULE_ID}.city`;
export const REGION_TYPE = `${MODULE_ID}.region`;
export const COUNTRY_TYPE = `${MODULE_ID}.country`;
// A guild, noble house, syndicate and the like: not tied to a city, it owns projects in any number of cities.
export const ORGANIZATION_TYPE = `${MODULE_ID}.organization`;
// Kinds offered when naming what an organization is; any other text is fine too.
export const ORGANIZATION_KINDS = ["guild", "house", "syndicate", "church", "company", "order"];
// An organization's influence on a city is its share of the city's running projects: below each bound, that level.
export const INFLUENCE_LEVELS = [{ level: "minor", below: 0.1 }, { level: "notable", below: 0.25 }, { level: "strong", below: 0.5 }, { level: "dominant", below: Infinity }];

// Counters of a city, region or country, kept like Daggerheart trackers: a value the GM moves and a maximum that
// features raise (three plantations: Supplies max +3). The scale is thousands of lives, so nothing is counted daily.
// The key "faith" is the peace between the faiths of a city; it keeps its old key so existing effects still apply.
// "satisfaction" is how content the people are.
export const COUNTERS = ["supplies", "materials", "stability", "order", "faith", "satisfaction", "power"];
// Counters a project can cost.
export const COSTS = ["supplies", "materials"];
// People of a city, as plain numbers.
export const PEOPLE = ["population", "guards"];
// Every counter can be needed: its people and features need levels of it (fishers need 1 Materials, a garrison needs
// Materials), and other features have to give them. What is left once the needs have taken their share is what the
// sheets show; a city with less than it needs gets a shortage feature.
export const NEEDS = [...COUNTERS];
// A city needs one level of Supplies for every thousand people, residents and guards alike; a started thousand counts.
export const PEOPLE_PER_SUPPLY = 1000;
export const ICONS = {
	supplies: "fa-solid fa-wheat-awn",
	materials: "fa-solid fa-cubes",
	stability: "fa-solid fa-scale-balanced",
	order: "fa-solid fa-gavel",
	faith: "fa-solid fa-dove",
	satisfaction: "fa-solid fa-face-smile",
	power: "fa-solid fa-chess-knight",
	population: "fa-solid fa-people-group",
	guards: "fa-solid fa-shield-halved"
};
// Up to this maximum a counter is drawn as boxes, like a Daggerheart tracker; above it, as a number.
export const MAX_BOXES = 20;

export const PROJECT_STATUSES = ["active", "paused", "available", "locked", "completed"];
// How a project works. A project only gives features; the features give the resources. Once: built over its days, then
// completed, leaving its features for good. Lasting: built over its days (0: at once), then runs, holding its features
// while active; switched off, it takes them back, and switched on again, it needs no new building.
export const PROJECT_KINDS = ["lasting", "once"];

export const DEFAULT_CITY_ICON = "icons/environment/settlement/city-hall.webp";
export const DEFAULT_REGION_ICON = "icons/tools/navigation/map-marked-red.webp";
export const DEFAULT_COUNTRY_ICON = "icons/environment/settlement/castle.webp";
export const DEFAULT_ORGANIZATION_ICON = "icons/sundries/flags/banner-standard-purple.webp";
export const DEFAULT_PROJECT_ICON = "icons/tools/hand/hammer-and-nail.webp";
export const DEFAULT_FEATURE_ICON = "icons/magic/symbols/star-solid-gold.webp";
export const SHORTAGE_ICON = "icons/consumables/grains/sack-grain-open-white.webp";
