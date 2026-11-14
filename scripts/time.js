import { CITY_TYPE } from "./constants.js";

// The economy counts its own days, apart from the world time and any calendar: each city keeps the day it has reached.

/** The economy's day: the furthest any city has reached. */
export function economyDay() {
	return Math.max(0, ...game.actors.filter(actor => actor.type === CITY_TYPE).map(city => city.system.day ?? 0));
}

/** Today in the economy, as the sheets and reports show it. */
export function currentDate() {
	return game.i18n.format("MIST_ECO.Day", { day: economyDay() });
}
