import { FILE_REVIEW_INVOCATIONS, PACKAGE_NAME } from "./file-review/typert-descriptors.js";
//#region src/file-review/typert.host.ts
const TYPERT = {
	package: PACKAGE_NAME,
	face: "host",
	schemas: [],
	invocations: FILE_REVIEW_INVOCATIONS,
	model: {
		services: [{
			key: "fileReview",
			exportName: "FileReviewService",
			summary: "Safely inspect and toggle one turn of produced text changes.",
			tags: [],
			members: [],
			types: []
		}],
		events: [],
		objects: []
	}
};
//#endregion
export { TYPERT, TYPERT as default };
