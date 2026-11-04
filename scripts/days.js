import { CITY_TYPE, COUNTERS, MODULE_ID } from "./constants.js";
import { grantItems } from "./features.js";
import { effectiveCounters, getCountry, getRegion, placeLabel, storedCounterValue } from "./hierarchy.js";
import { advanceDays, hasNews } from "./logic.js";
import { groupName } from "./models.js";
import { currentDate, secondsPerDay, worldDay } from "./time.js";

// Day counts are applied one after another, so overlapping time changes never count a day twice.
let queue = Promise.resolve();

function label(key) {
	return game.i18n.localize(`MIST_ECO.Resources.${key}`);
}

function signed(value) {
	return value > 0 ? `+${value}` : `${value}`;
}

export function alertText(alerts) {
	return alerts.map(alert => game.i18n.localize(`MIST_ECO.Alerts.${alert}`)).join(", ");
}

/** Counts the days that passed in the world for the projects of every city. Called on the active GM. */
function onWorldTime() {
	if (!game.users.activeGM?.isSelf) {
		return;
	}
	const today = worldDay();
	queue = queue.then(() => catchUp(today)).catch(error => console.error(`${MODULE_ID} | days`, error));
}

async function catchUp(today) {
	const cities = game.actors.filter(actor => actor.type === CITY_TYPE);
	for (const city of cities.filter(entry => entry.system.day === null || entry.system.day > today)) {
		// A new city, or time moved back: start counting from today without undoing anything.
		await city.update({ "system.day": today });
	}
	const behind = cities.filter(city => city.system.day < today);
	if (behind.length) {
		await passDays(behind, today);
	}
}

/**
 * Lets days pass for the projects of these cities up to the end day. Rewards move counters up to their maxima after
 * effects; completed projects leave features on the city, its region or its country. One report covers them all.
 */
export async function passDays(cities, end) {
	const results = [];
	for (const city of cities) {
		const before = city.system.toObject();
		// Rewards move stored values; a stored value may reach the maximum after effects less what effects add to the value.
		const effective = effectiveCounters(city);
		const maxima = Object.fromEntries(COUNTERS.map(key => [key, storedCounterValue(city, key, effective[key].max)]));
		const names = { population: groupName("population"), guards: groupName("guards") };
		const { data, report } = advanceDays(before, end - (before.day ?? end), Math.random, maxima, names);
		data.day = end;
		await city.update({ system: data });
		await grantFeatures(city, report.features);
		if (hasNews(report)) {
			results.push({ city, data, report });
		}
	}
	await postReport(results);
}

/** Features of completed projects go to the city, or to its region or country as the project says. */
async function grantFeatures(city, entries) {
	const holders = { city, region: getRegion(city) ?? city, country: getCountry(city) ?? getRegion(city) ?? city };
	for (const level of ["city", "region", "country"]) {
		await grantItems(holders[level], entries.filter(entry => entry.grant.target === level));
	}
}

/** Moves the world time a number of days; the days are then counted for every city. */
export async function advanceButton(days) {
	await game.time.advance(days * secondsPerDay());
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
			gains: Object.entries(report.gains).filter(([, amount]) => amount).map(([key, amount]) => `${signed(amount)} ${label(key)}`).join(", "),
			yields: Object.entries(report.yields).map(([id, gains]) => ({
				name: projectName(data, id),
				gains: Object.entries(gains).map(([key, amount]) => `${signed(amount)} ${label(key)}`).join(", ")
			})),
			completed: report.completed.map(id => projectName(data, id)),
			unlocked: report.unlocked.map(id => projectName(data, id)),
			features: report.features.map(entry => entry.grant.name),
			lost: Object.entries(report.lost).map(([key, amount]) => `${amount} ${label(key)}`).join(", ")
		}))
	});
	const whisper = game.users.filter(user => user.isGM).map(user => user.id);
	await ChatMessage.implementation.create({ content, whisper, speaker: { alias: game.i18n.localize("MIST_ECO.Report.Speaker") } });
}

/** Called during init. */
export function registerDays() {
	Hooks.on("updateWorldTime", onWorldTime);
	// Days that passed while no GM was connected are counted when one connects.
	Hooks.once("ready", onWorldTime);
}

