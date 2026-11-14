import { COSTS, COUNTERS, DEFAULT_CITY_ICON, DEFAULT_COUNTRY_ICON, DEFAULT_FEATURE_ICON, DEFAULT_ORGANIZATION_ICON, DEFAULT_PROJECT_ICON, DEFAULT_REGION_ICON, NEEDS, PROJECT_KINDS, PROJECT_STATUSES } from "./constants.js";
import { countPeople, getWorkers, newGroup, supplyNeed } from "./logic.js";

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
	// A number an effect adds to though nothing is stored yet: no value counts as 0.
	class InfluenceField extends fields.NumberField {
		_applyChangeAdd(value, delta) {
			return (Number(value) || 0) + delta;
		}
	}
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
				// What effects add to organizations' influence here, by organization id: a change "system.influence.<id>" Add N.
				// The influence itself is read from the effects; the field lets the change apply without a value stored.
				influence: new fields.TypedObjectField(new InfluenceField({ integer: true })),
				// What the city needs of a counter besides what its people eat; effects of features add to it, and may take
				// away from it (slaves eat less), so it may go below zero until the people's need is added.
				needs: new fields.SchemaField(Object.fromEntries(NEEDS.map(key => [key, number({ integer: true })]))),
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
					kind: new fields.StringField({ required: true, choices: PROJECT_KINDS, initial: "lasting" }),
					// Taken from the counters' values when the project starts.
					cost: new fields.SchemaField(Object.fromEntries(COSTS.map(key => [key, count()]))),
					// Residents busy on the project while it is active.
					workers: count(),
					// The organization behind the project, as an actor uuid; it gives that organization influence here.
					organization: new fields.StringField({ initial: "" }),
					// Organizations the project also gives its influence to, as actor uuids: temple knights who serve a noble house.
					allies: new fields.ArrayField(new fields.StringField()),
					// How much influence the project gives its organization: a fleet weighs more than a tavern.
					influence: number({ integer: true, min: 0, initial: 1 }),
					unlocks: new fields.ArrayField(new fields.StringField()),
					// The features the project gives; they give the resources. Each links a feature item.
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

		/**
		 * Cities of the first versions kept residents and guards as two numbers; they become a group each. Projects that
		 * repeated, or ran with 0 days, become lasting ones that are already built; the others are built once. Projects no
		 * longer have rewards: what they give comes from their features.
		 */
		static migrateData(source) {
			for (const project of source.projects ?? []) {
				if (project.kind === "repeat" || (!("kind" in project) && (project.repeat || project.days === 0))) {
					project.kind = "lasting";
					project.progress = Math.max(project.progress ?? 0, project.days ?? 0);
				} else if (!("kind" in project)) {
					project.kind = "once";
				}
			}
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
			// The people need Supplies on top of what effects make the city need; no need is below zero.
			this.peopleNeed = supplyNeed(this.groups);
			this.needs.supplies += this.peopleNeed;
			for (const key of NEEDS) {
				this.needs[key] = Math.max(0, this.needs[key]);
			}
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

	/**
	 * An organization: a guild, noble house, syndicate and the like. It is not tied to a city: the projects of any city can
	 * name it, and its influence on a city comes from those projects. It holds features of its own.
	 */
	class OrganizationData extends Base {
		static DEFAULT_ICON = DEFAULT_ORGANIZATION_ICON;

		static get metadata() {
			return metadata(OrganizationData, "organization");
		}

		static defineSchema() {
			return {
				...super.defineSchema(),
				// What it is: a guild, a noble house, a syndicate; free text.
				kind: new fields.StringField({ initial: "" }),
				// The organization it is part of, as an actor uuid: a legion of the Crown. Its projects count for that one too.
				parent: new fields.StringField({ initial: "" }),
				// What its effects add to its influence in every city where it has running projects: "system.influence" Add N.
				influence: new InfluenceField({ integer: true, initial: 0 })
			};
		}

		isItemValid(source) {
			return source.type === "feature";
		}
	}

	return { CityData, RegionData, CountryData, OrganizationData };
}
