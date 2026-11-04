import { MODULE_ID } from "./constants.js";

/** Length of a day in seconds, from Simple Calendar, else the core calendar. */
export function secondsPerDay() {
	const time = globalThis.SimpleCalendar?.api?.getTimeConfiguration?.();
	if (time?.hoursInDay) {
		return time.hoursInDay * time.minutesInHour * time.secondsInMinute;
	}
	const days = game.time.calendar?.days;
	if (days?.hoursPerDay) {
		return days.hoursPerDay * days.minutesPerHour * days.secondsPerMinute;
	}
	return 86400;
}

/** The number of the current world day. */
export function worldDay() {
	return Math.floor(game.time.worldTime / secondsPerDay());
}

/** Today's date as the calendar shows it. */
export function currentDate() {
	try {
		const date = globalThis.SimpleCalendar?.api?.currentDateTimeDisplay?.()?.date;
		if (date) {
			return date;
		}
	} catch (error) {
		console.warn(`${MODULE_ID} | Simple Calendar date`, error);
	}
	return game.i18n.format("MIST_ECO.Day", { day: worldDay() });
}
