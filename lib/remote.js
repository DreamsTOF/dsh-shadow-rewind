import { FILE_REVIEW_INVOCATIONS, PACKAGE_NAME } from "./file-review/typert-descriptors.js";
//#region src/file-review/remote.ts
const TYPERT_REMOTE = {
	package: PACKAGE_NAME,
	descriptors: FILE_REVIEW_INVOCATIONS
};
//#endregion
export { TYPERT_REMOTE, TYPERT_REMOTE as default };
