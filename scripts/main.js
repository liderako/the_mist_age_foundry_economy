import { CitySheet } from "./city-sheet.js";
import { CITY_TYPE, COUNTRY_TYPE, MODULE_ID, ORGANIZATION_TYPE, REGION_TYPE } from "./constants.js";
import { registerEffectConfig } from "./effect-config.js";
import { defineModels } from "./models.js";
import { registerOrganizationLinks } from "./organization-links.js";
import { OrganizationSheet } from "./organization-sheet.js";
import { registerSync } from "./sync.js";
import { CountrySheet, RegionSheet, registerRefresh } from "./territory-sheet.js";

Hooks.once("init", () => {
	const { CityData, RegionData, CountryData, OrganizationData } = defineModels();
	CONFIG.Actor.dataModels[CITY_TYPE] = CityData;
	CONFIG.Actor.dataModels[REGION_TYPE] = RegionData;
	CONFIG.Actor.dataModels[COUNTRY_TYPE] = CountryData;
	CONFIG.Actor.dataModels[ORGANIZATION_TYPE] = OrganizationData;
	CONFIG.Actor.typeIcons ??= {};
	CONFIG.Actor.typeIcons[CITY_TYPE] = "fa-solid fa-city";
	CONFIG.Actor.typeIcons[REGION_TYPE] = "fa-solid fa-map";
	CONFIG.Actor.typeIcons[COUNTRY_TYPE] = "fa-solid fa-chess-rook";
	CONFIG.Actor.typeIcons[ORGANIZATION_TYPE] = "fa-solid fa-landmark-flag";
	const { Actors } = foundry.documents.collections;
	Actors.registerSheet(MODULE_ID, CitySheet, { types: [CITY_TYPE], makeDefault: true, label: "MIST_ECO.Sheets.city" });
	Actors.registerSheet(MODULE_ID, RegionSheet, { types: [REGION_TYPE], makeDefault: true, label: "MIST_ECO.Sheets.region" });
	Actors.registerSheet(MODULE_ID, CountrySheet, { types: [COUNTRY_TYPE], makeDefault: true, label: "MIST_ECO.Sheets.country" });
	Actors.registerSheet(MODULE_ID, OrganizationSheet, { types: [ORGANIZATION_TYPE], makeDefault: true, label: "MIST_ECO.Sheets.organization" });
	// The influence table is a partial shared by the city, region and country sheets.
	foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/influence-table.hbs`]);
	registerEffectConfig();
	registerRefresh();
	registerOrganizationLinks();
	registerSync();
});
