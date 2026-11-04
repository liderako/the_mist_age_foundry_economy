import { CitySheet } from "./city-sheet.js";
import { CITY_TYPE, COUNTRY_TYPE, MODULE_ID, REGION_TYPE } from "./constants.js";
import { registerDays } from "./days.js";
import { defineModels } from "./models.js";
import { CountrySheet, RegionSheet, registerRefresh } from "./territory-sheet.js";

Hooks.once("init", () => {
	const { CityData, RegionData, CountryData } = defineModels();
	CONFIG.Actor.dataModels[CITY_TYPE] = CityData;
	CONFIG.Actor.dataModels[REGION_TYPE] = RegionData;
	CONFIG.Actor.dataModels[COUNTRY_TYPE] = CountryData;
	CONFIG.Actor.typeIcons ??= {};
	CONFIG.Actor.typeIcons[CITY_TYPE] = "fa-solid fa-city";
	CONFIG.Actor.typeIcons[REGION_TYPE] = "fa-solid fa-map";
	CONFIG.Actor.typeIcons[COUNTRY_TYPE] = "fa-solid fa-chess-rook";
	const { Actors } = foundry.documents.collections;
	Actors.registerSheet(MODULE_ID, CitySheet, { types: [CITY_TYPE], makeDefault: true, label: "MIST_ECO.Sheets.city" });
	Actors.registerSheet(MODULE_ID, RegionSheet, { types: [REGION_TYPE], makeDefault: true, label: "MIST_ECO.Sheets.region" });
	Actors.registerSheet(MODULE_ID, CountrySheet, { types: [COUNTRY_TYPE], makeDefault: true, label: "MIST_ECO.Sheets.country" });
	registerDays();
	registerRefresh();
});
