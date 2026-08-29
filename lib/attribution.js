//#region src/attribution.ts
/** 快照条目的稳定比较键（内容 blob + 类型 + 权限位）；null = 路径不存在。 */
function entryKey(entry) {
	if (entry === null) return "-";
	return entry.kind === "file" ? `f:${entry.blob}:${entry.mode.toString(36)}` : `s:${entry.target}:${entry.mode.toString(36)}`;
}
function attributePaths(options) {
	const result = /* @__PURE__ */ new Map();
	for (const change of options.changes) {
		const states = [change.before ?? null];
		for (const snapshot of options.snapshots) states.push(snapshot.entries[change.path] ?? null);
		states.push(change.after ?? null);
		const owners = /* @__PURE__ */ new Set();
		for (let j = 0; j + 1 < states.length; j += 1) {
			if (entryKey(states[j] ?? null) === entryKey(states[j + 1] ?? null)) continue;
			const owner = j === 0 ? options.targetSessionId : options.snapshots[j - 1]?.sessionId;
			owners.add(owner ?? "unknown");
		}
		const others = [...owners].filter((id) => id !== options.targetSessionId);
		const singleOther = others[0];
		let attribution;
		if (owners.size === 0) attribution = {
			owner: { kind: "unknown" },
			autoSelect: false
		};
		else if (others.length === 0) attribution = {
			owner: { kind: "target" },
			autoSelect: true
		};
		else if (owners.size === 1 && singleOther !== void 0 && singleOther !== "unknown") attribution = {
			owner: {
				kind: "session",
				sessionId: singleOther
			},
			autoSelect: false
		};
		else if (owners.size === 1) attribution = {
			owner: { kind: "unknown" },
			autoSelect: false
		};
		else attribution = {
			owner: { kind: "multi" },
			autoSelect: false
		};
		result.set(change.path, attribution);
	}
	return result;
}
/** HTTP 序列化：'target' | 'multi' | 'unknown' | 具体会话 id。 */
function serializeOwner(owner) {
	switch (owner.kind) {
		case "target": return "target";
		case "session": return owner.sessionId;
		case "multi": return "multi";
		default: return "unknown";
	}
}
//#endregion
export { attributePaths, serializeOwner };
