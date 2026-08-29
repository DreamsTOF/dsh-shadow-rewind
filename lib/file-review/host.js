import { FileReviewService, transformFile } from "./file-review-service.js";
//#region src/file-review/host.ts
/** 稳定的最终回复引导：与浏览器端的文件引用渲染器一一配对。 */
const FILE_REFERENCE_PROMPT = "When you successfully create or modify files, mention the primary outputs in your final response. To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn.";
/**
* 在插件宿主上下文里装配全部文件审查能力，返回创建的 FileReviewService。
* @param ctx - 宿主 cordis 上下文（携带 system-prompt 注册表与工具瀑布）。
*/
function installFileReviewHost(ctx, options = {}) {
	const service = new FileReviewService(ctx, options);
	ctx.inject(["systemPrompt"], (scope) => {
		scope.systemPrompt.section({
			name: "ui:file-review-references",
			order: 190,
			text: FILE_REFERENCE_PROMPT
		});
	});
	const emitter = ctx;
	ctx.effect(() => {
		const off = emitter.on("tools/post-execute", async (execRaw, resultRaw, nextRaw) => {
			const exec = execRaw;
			const result = resultRaw;
			const decision = await nextRaw();
			if (decision.kind !== "accept") return decision;
			if (exec.parent === void 0 || exec.agent === void 0) return decision;
			const value = result.value;
			if (typeof value !== "object" || value === null || Array.isArray(value)) return decision;
			const candidate = value;
			if (typeof candidate.path !== "string" || typeof candidate.after !== "string") return decision;
			if (candidate.before !== null && typeof candidate.before !== "string") return decision;
			service.recordMutation(exec.agent, {
				rootCallId: String(exec.rootCallId ?? exec.callId),
				name: exec.name,
				path: candidate.path,
				before: candidate.before ?? null,
				after: candidate.after
			});
			return decision;
		});
		return () => {
			off();
		};
	}, "shadow-rewind: ptc recorder");
	return service;
}
//#endregion
export { FileReviewService, installFileReviewHost, transformFile };
