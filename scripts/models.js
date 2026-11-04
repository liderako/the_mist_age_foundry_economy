import { COSTS, COUNTERS, DEFAULT_CITY_ICON, DEFAULT_COUNTRY_ICON, DEFAULT_FEATURE_ICON, DEFAULT_PROJECT_ICON, DEFAULT_REGION_ICON, PEOPLE, PROJECT_STATUSES } from "./constants.js";
import { countPeople, getWorkers, newGroup } from "./logic.js";

/** The name of a city's first group of residents or guards, in the world's language once texts are loaded. */
export function groupName(kind) {
	const key = `MIST_ECO.Groups.Default.${kind}`;
	return globalThis.game?.i18n?.has?.(key) ? game.i18n.localize(key) : { population: "Residents", guards: "Guards" }[kind];
}

/**
 * Data models of cities, regions and countries. They extend the Daggerheart base actor model, so system code that reads
 * actor metadata works with them, and hold Daggerheart feature items, whose effects raise a city's counters, or for a
 * region or country, the counters of every city inside. Called during init, after the system's init.
 */
export function defineModels() {
	const fields = foundry.data.fields;
	const Base = Object.getPrototypeOf(CONFIG.Actor.dataModels.npc);
	const id = () => new fields.StringField({ required: true, blank: false, initial: () => foundry.utils.randomID() });
	const number = (options = {}) => new fields.NumberField({ required: true, nullable: false, initial: 0, ...options });
	const count = () => number({ integer: true, min: 0 });

	// A city's counters: a value moved by the GM and a maximum features raise.
	const counters = () => new fields.SchemaField(Object.fromEntries(COUNTERS.map(key => [key, new fields.SchemaField({
		value: count(),
		max: count()
	})])));
	// What a region's or country's effects add to the counters of every city inside; may be negative.
	const bonuses = () => new fields.SchemaField(Object.fromEntries(COUNTERS.map(key => [key, new fields.SchemaField({
		value: number({ integer: true }),
		max: number({ integer: true })
	})])));
	const metadata = (Model, type) => foundry.utils.mergeObject(Object.getPrototypeOf(Model).metadata, {
		label: `TYPES.Actor.mist-age-economy.${type}`,
		type,
		hasResistances: false,
		hasAttribution: false,
		hasInventory: false,
		settingSheet: null
	});

	class CityData extends Base {
		static DEFAULT_ICON = DEFAULT_CITY_ICON;

		static get metadata() {
			return metadata(CityData, "city");
		}

		static defineSchema() {
			return {
				...super.defineSchema(),
				counters: counters(),
				region: new fields.StringField({ initial: "" }),
				// Groups of people: residents, or guards who keep watch. A new city starts with one group of each.
				groups: new fields.ArrayField(new fields.SchemaField({
					id: id(),
					name: new fields.StringField({ required: true, blank: false, initial: "Group" }),
					count: count(),
					guard: new fields.BooleanField({ initial: false }),
					canWork: new fields.BooleanField({ initial: true })
				}), { initial: () => [newGroup(false, groupName("population")), newGroup(true, groupName("guards"))] }),
				// The last world day already counted for projects.
				day: new fields.NumberField({ nullable: true, initial: null, integer: true }),
				projects: new fields.ArrayField(new fields.SchemaField({
					id: id(),
					name: new fields.StringField({ required: true, blank: false, initial: "Project" }),
					img: new fields.FilePathField({ categories: ["IMAGE"], initial: DEFAULT_PROJECT_ICON }),
					description: new fields.HTMLField({ initial: "" }),
					status: new fields.StringField({ required: true, choices: PROJECT_STATUSES, initial: "available" }),
					days: count(),
					progress: count(),
					repeat: new fields.BooleanField({ initial: false }),
					// Taken from the counters' values when the project starts.
					cost: new fields.SchemaField(Object.fromEntries(COSTS.map(key => [key, count()]))),
					// Residents busy on the project while it is active.
					workers: count(),
					rewards: new fields.ArrayField(new fields.SchemaField({
						target: new fields.StringField({ required: true, choices: [...COUNTERS, ...PEOPLE], initial: "supplies" }),
						mode: new fields.StringField({ required: true, choices: ["fixed", "range"], initial: "fixed" }),
						amount: number(),
						min: number(),
						max: number(),
						whole: new fields.BooleanField({ initial: true }),
						chance: number({ initial: 1, min: 0, max: 1 })
					})),
					unlocks: new fields.ArrayField(new fields.StringField()),
					grants: new fields.ArrayField(new fields.SchemaField({
						uuid: new fields.StringField({ initial: "" }),
						name: new fields.StringField({ required: true, blank: false, initial: "Feature" }),
						img: new fields.FilePathField({ categories: ["IMAGE"], initial: DEFAULT_FEATURE_ICON }),
						description: new fields.StringField({ initial: "" }),
						target: new fields.StringField({ required: true, choices: ["city", "region", "country"], initial: "city" })
					}))
				}))
			};
		}

		/** Cities of the first versions kept residents and guards as two numbers; they become a group each. */
		static migrateData(source) {
			if (!("groups" in source) && (("population" in source) || ("guards" in source))) {
				source.groups = [
					{ ...newGroup(false, groupName("population")), count: Math.max(0, Math.round(Number(source.population) || 0)) },
					{ ...newGroup(true, groupName("guards")), count: Math.max(0, Math.round(Number(source.guards) || 0)) }
				];
			}
			return super.migrateData(source);
		}

		prepareDerivedData() {
			super.prepareDerivedData();
			const { population, guards } = countPeople(this.groups);
			this.population = population;
			this.guards = guards;
			this.workers = getWorkers(this);
		}

		isItemValid(source) {
			return source.type === "feature";
		}
	}

	class RegionData extends Base {
		static DEFAULT_ICON = DEFAULT_REGION_ICON;

		static get metadata() {
			return metadata(RegionData, "region");
		}

		static defineSchema() {
			return {
				...super.defineSchema(),
				bonuses: bonuses(),
				country: new fields.StringField({ initial: "" })
			};
		}

		isItemValid(source) {
			return source.type === "feature";
		}
	}

	class CountryData extends Base {
		static DEFAULT_ICON = DEFAULT_COUNTRY_ICON;

		static get metadata() {
			return metadata(CountryData, "country");
		}

		static defineSchema() {
			return {
				...super.defineSchema(),
				bonuses: bonuses()
			};
		}

		isItemValid(source) {
			return source.type === "feature";
		}
	}

	return { CityData, RegionData, CountryData };
}
