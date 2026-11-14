import { CITY_TYPE, MODULE_ID } from "./constants.js";
import { grantItems } from "./features.js";
import { getCountry, getRegion, placeLabel } from "./hierarchy.js";
import { advanceDays, hasNews, settleProjects } from "./logic.js";
import { currentDate, economyDay } from "./time.js";

// The economy keeps its own days: they pass only with the sheets' buttons, never with the world time or a calendar.
// Day counts are applied one after another, so two clicks at once never count a day twice.
let queue = Promise.resolve();

export function alertText(alerts) {
	return alerts.map(alert => game.i18n.localize(`MIST_ECO.Alerts.${alert}`)).join(", ");
}

/**
 * Lets a number of days pass for the projects of these cities. Completed one-time projects leave features on the city,
 * its region or its country; built lasting ones start holding theirs. One report covers them all.
 */
export async function passDays(cities, days) {
	const results = [];
	const start = economyDay();
	for (const city of cities) {
		const before = city.system.toObject();
		const { data, report } = advanceDays(before, days);
		data.day = (before.day ?? start) + days;
		await city.update({ system: data });
		await grantFeatures(city, report.features);
		if (hasNews(report)) {
			results.push({ city, data, report });
		}
	}
	await postReport(results);
}

/** Completes the city's one-time projects that have no days left to work, without waiting for a day to pass. */
export async function settleCity(city) {
	const { data, report } = settleProjects(city.system.toObject());
	if (!hasNews(report)) {
		return;
	}
	await city.update({ "system.projects": data.projects });
	await grantFeatures(city, report.features);
	await postReport([{ city, data, report }]);
}

/** Features of completed projects go to the city, or to its region or country as the project says. */
async function grantFeatures(city, entries) {
	const holders = { city, region: getRegion(city) ?? city, country: getCountry(city) ?? getRegion(city) ?? city };
	for (const level of ["city", "region", "country"]) {
		await grantItems(holders[level], entries.filter(entry => entry.grant.target === level));
	}
}

/** Lets days pass for every city: the world time and any calendar stay as they are. */
export async function advanceButton(days) {
	const cities = game.actors.filter(actor => actor.type === CITY_TYPE);
	queue = queue.then(() => passDays(cities, days)).catch(error => console.error(`${MODULE_ID} | days`, error));
	await queue;
}

/** Asks how many days to let pass; null if the dialog is closed. */
export async function askDays() {
	const localize = key => game.i18n.localize(`MIST_ECO.Days.${key}`);
	return foundry.applications.api.DialogV2.prompt({
		window: { title: localize("PassTitle"), icon: "fa-solid fa-forward" },
		content: `<div class="form-group"><label>${localize("Count")}</label><div class="form-fields"><input type="number" name="days" value="1" min="1" step="1" autofocus></div></div>`,
		ok: { label: localize("Pass"), callback: (event, button) => Math.round(Number(button.form.elements.days.value)) }
	});
}

async function postReport(results) {
	if (!results.length) {
		return;
	}
	const projectName = (data, id) => data.projects.find(project => project.id === id)?.name ?? id;
	const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/report.hbs`, {
		days: results[0].report.days,
		date: currentDate(),
		cities: results.map(({ city, data, report }) => ({
			name: city.name,
			img: city.img,
			place: placeLabel(city),
			completed: report.completed.map(id => projectName(data, id)),
			built: report.built.map(id => projectName(data, id)),
			unlocked: report.unlocked.map(id => projectName(data, id)),
			features: report.features.map(entry => entry.grant.name)
		}))
	});
	const whisper = game.users.filter(user => user.isGM).map(user => user.id);
	await ChatMessage.implementation.create({ content, whisper, speaker: { alias: game.i18n.localize("MIST_ECO.Report.Speaker") } });
}


