//#region src/inplace/plan.ts
/** 是否是直发用户消息（source.kind==='user'）。注入 context / compact 检查点 /
* 工具回填都以非 'user' source 到达 user/message，绝不能作为回退边界。 */
function isHumanUserMessage(event) {
	return event.type === "user/message" && event.data?.source?.kind === "user" && typeof event.seq === "number" && Number.isSafeInteger(event.seq);
}
/** 就地回退规划的失败。 */
var InPlacePlanError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
		this.name = "InPlacePlanError";
	}
};
/**
* 校验一个目标 seq 并计算遮蔽区间。
* 规则：目标必须是直发用户消息且仍在 surface 上；遮蔽区间**含目标**及其后
* 全部 surface 节点（时间旅行：回退到该消息之前，其内容回填 composer 供重发）。
*/
function planInPlace(options) {
	const { events, surface, targetSeq } = options;
	const targetEvent = events.find((event) => event.seq === targetSeq);
	if (targetEvent === void 0 || !isHumanUserMessage(targetEvent)) throw new InPlacePlanError("NOT_A_USER_MESSAGE", `seq ${String(targetSeq)} 不是可回退的直发用户消息`);
	const targetIndex = surface.indexOf(targetSeq);
	if (targetIndex === -1) throw new InPlacePlanError("NOT_ON_SURFACE", `seq ${String(targetSeq)} 已被 compact 遮蔽，不在模型上下文里`);
	const shadowedSeqs = surface.slice(targetIndex);
	if (shadowedSeqs.length === 0) throw new InPlacePlanError("NOT_ON_SURFACE", "surface 区间为空，无法回退");
	return {
		targetSeq,
		targetIndex,
		shadowedSeqs,
		surfaceStart: shadowedSeqs[0],
		surfaceEnd: shadowedSeqs[shadowedSeqs.length - 1]
	};
}
//#endregion
export { InPlacePlanError, isHumanUserMessage, planInPlace };
