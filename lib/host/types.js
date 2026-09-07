//#region src/host/types.ts
/**
* 读会话事件：兼容 0.1.2 `Session.snapshotEvents()` 与旧 runtime 的 `events`
* 数组两种形态（事件面缺失返回空，不抛错）。
*/
function sessionEvents(session) {
	if (session === void 0 || session === null) return [];
	if (Array.isArray(session.events)) return session.events;
	return session.snapshotEvents?.() ?? [];
}
//#endregion
export { sessionEvents };
