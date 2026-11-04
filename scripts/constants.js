export const MODULE_ID = "mist-age-economy";
// The actor sub-types this module adds, nested country → region → city. Module sub-types carry the module id.
export const CITY_TYPE = `${MODULE_ID}.city`;
export const REGION_TYPE = `${MODULE_ID}.region`;
export const COUNTRY_TYPE = `${MODULE_ID}.country`;

// Counters of a city, region or country, kept like Daggerheart trackers: a value the GM moves and a maximum that
// features raise (three plantations: Supplies max +3). The scale is thousands of lives, so nothing is counted daily.
export const COUNTERS = ["supplies", "materials", "stability", "order", "faith", "power"];
// Counters a project can cost.
export const COSTS = ["supplies", "materials"];
// People of a city, as plain numbers.
export const PEOPLE = ["population", "guards"];
export const ICONS = {
	supplies: "fa-solid fa-wheat-awn",
	materials: "fa-solid fa-cubes",
	stability: "fa-solid fa-scale-balanced",
	order: "fa-solid fa-gavel",
	faith: "fa-solid fa-place-of-worship",
	power: "fa-solid fa-chess-knight",
	population: "fa-solid fa-people-group",
	guards: "fa-solid fa-shield-halved"
};
// Up to this maximum a counter is drawn as boxes, like a Daggerheart tracker; above it, as a number.
export const MAX_BOXES = 20;

export const PROJECT_STATUSES = ["active", "paused", "available", "locked", "completed"];

export const DEFAULT_CITY_ICON = "icons/environment/settlement/city-hall.webp";
export const DEFAULT_REGION_ICON = "icons/tools/navigation/map-marked-red.webp";
export const DEFAULT_COUNTRY_ICON = "icons/environment/settlement/castle.webp";
export const DEFAULT_PROJECT_ICON = "icons/tools/hand/hammer-and-nail.webp";
export const DEFAULT_FEATURE_ICON = "icons/magic/symbols/star-solid-gold.webp";
