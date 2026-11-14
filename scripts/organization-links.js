import { CITY_TYPE, MODULE_ID, ORGANIZATION_TYPE } from "./constants.js";

// When an organization is deleted, nothing should keep pointing at it: projects that named it no longer have an
// organization, and organizations that were part of it become independent. The active GM makes the change.

async function forgetOrganization(organization) {
	if (organization?.type !== ORGANIZATION_TYPE || !game.users.activeGM?.isSelf) {
		return;
	}
	const uuid = organization.uuid;
	for (const city of game.actors.filter(actor => actor.type === CITY_TYPE && actor.system.projects.some(project => project.organization === uuid))) {
		const projects = city.system.toObject().projects.map(project => (project.organization === uuid ? { ...project, organization: "" } : project));
		await city.update({ "system.projects": projects });
	}
	for (const member of game.actors.filter(actor => actor.type === ORGANIZATION_TYPE && actor.system.parent === uuid)) {
		await member.update({ "system.parent": "" });
	}
}

/** Called during init. */
export function registerOrganizationLinks() {
	Hooks.on("deleteActor", actor => {
		forgetOrganization(actor).catch(error => console.error(`${MODULE_ID} | organization links`, error));
	});
}
