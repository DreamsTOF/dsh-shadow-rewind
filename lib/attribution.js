//#region src/attribution.ts
/** 快照条目的稳定比较键（内容 blob + 类型 + 权限位）；null = 路径不存在。 */
function entryKey(entry) {
	if (entry === null) return "-";
	if (entry.kind === "file") return `f:${entry.blob}:${entry.mode.toString(36)}`;
	if (entry.kind === "dir") return `d:${entry.mode.toString(36)}`;
	return `s:${entry.target}:${entry.mode.toString(36)}`;
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
/** 十进制纳秒字符串 → ms epoch（整除截断；数值远低于 2^53，精度无损）。 */
function mtimeNsToMs(mtimeNs) {
	return Number(BigInt(mtimeNs) / 1000000n);
}
/**
* 终端写盘归因（纯函数 + 一次注册表查询）：在窗口归属（attributePaths 的
* ownership）之上，用「文件 mtime ∈ 命令窗口 [startedAt, endedAt]」关联到
* 具体命令。仅恰 1 条窗口覆盖才给命令级置信——宁模糊不错。
* 包围轮盲区：完全包住本窗口的其它会话轮在快照网格里没有证据，其写入
* 会被窗口归属误判为本会话；此时净值内容的 mtime 若落在其它会话的命令
* 窗口，即为明确的他写者证据——降级 `multi` 交出勾选权（绝不以本会话
* 名义默认勾选，见函数体注释）。
*
* @param windowStartMs/windowEndMs - 轮配对窗口 [current.createdAt, pairEnd.createdAt]，
* 只做窗口查询剪枝；匹配本身以 mtime 为准（长命令跨轮不漏配）。
*/
async function attributeFsChanges(options) {
	const windows = options.commandWindows === void 0 ? [] : await options.commandWindows.windowsOverlapping(options.cwd, options.windowStartMs, options.windowEndMs);
	const result = /* @__PURE__ */ new Map();
	for (const change of options.changes) {
		const pathAttribution = options.ownership.get(change.path);
		const owner = serializeOwner(pathAttribution?.owner ?? { kind: "unknown" });
		const autoSelect = pathAttribution?.autoSelect ?? false;
		const entry = change.after ?? change.before;
		const mtimeNs = entry?.kind === "file" ? entry.mtimeNs : void 0;
		const writtenAt = mtimeNs === void 0 ? void 0 : mtimeNsToMs(mtimeNs);
		const tail = writtenAt === void 0 ? {} : { writtenAt };
		const covering = writtenAt === void 0 ? [] : windows.filter((window) => window.startedAt <= writtenAt && writtenAt <= window.endedAt);
		const only = covering.length === 1 ? covering[0] : void 0;
		if (only !== void 0 && only.sessionId === options.targetSessionId) {
			result.set(change.path, {
				owner,
				autoSelect,
				attribution: "command",
				command: {
					tool: only.tool,
					...only.callId === void 0 ? {} : { callId: only.callId },
					sessionId: only.sessionId,
					startedAt: only.startedAt,
					endedAt: only.endedAt
				},
				...tail
			});
			continue;
		}
		if (owner === "target" && covering.some((window) => window.sessionId !== options.targetSessionId)) {
			result.set(change.path, {
				owner: "multi",
				autoSelect: false,
				attribution: "ambiguous",
				...tail
			});
			continue;
		}
		if (covering.length > 1) {
			result.set(change.path, {
				owner,
				autoSelect,
				attribution: "ambiguous",
				...tail
			});
			continue;
		}
		const kind = owner === "target" ? "external" : owner === "multi" ? "ambiguous" : owner === "unknown" ? "unknown" : "window";
		result.set(change.path, {
			owner,
			autoSelect,
			attribution: kind,
			...tail
		});
	}
	return result;
}
//#endregion
export { attributeFsChanges, attributePaths, serializeOwner };
