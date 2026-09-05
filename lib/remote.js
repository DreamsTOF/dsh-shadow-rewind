import { FILE_REVIEW_INVOCATIONS, PACKAGE_NAME } from "./file-review/typert-descriptors.js";
//#region src/file-review/remote.ts
/** 随客户端 bundle 分发的远端贡献声明。 */
const TYPERT_REMOTE = {
	package: PACKAGE_NAME,
	descriptors: FILE_REVIEW_INVOCATIONS
};
//#endregion
export { TYPERT_REMOTE, TYPERT_REMOTE as default };
