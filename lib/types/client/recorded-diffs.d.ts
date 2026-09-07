import type { ProducedFileDiff } from '../file-review/change-types.ts';
/**
 * 一次文件变更的行级 hunk；文件是新建的（`before === null`）时返回单条整文件
 * 条目（与 write 工具的 null 内容卡片同形）。变更没有实际改动文件时返回 []。
 */
export declare function diffsFromBeforeAfter(rawPath: string, rawBefore: string | null, rawAfter: string): readonly ProducedFileDiff[];
/**
 * 「本轮新建 + 同轮又被修改」的 hunk 收敛：序列里含创建 hunk（oldText=null）
 * 时，文件相对轮起的净变化就是「以最终内容新建」——从**最后一个**创建 hunk
 * 出发（更早的历史被整体覆盖，无关紧要），把后续编辑 hunk 顺序回放，收敛成
 * 单条 added 整文件形状：统计 = 最终行数（而非 hunk 累加的 +6 −3），撤销
 * 语义恢复为「删除文件」（混合 hunk 宿主无法回放，原本连撤销按钮都没有）。
 * 回放失配（锚点对不上）保守返回原序列——宁可保持现状，绝不猜出一个错误内容。
 * TODO: 天花板是「失配条目只能原样保留」；升级路径是把失配标注 degraded，
 * 交给检查点 fs 条目兜底（若该轮有捕获）。
 */
export declare function coalesceCreatedFileDiffs(diffs: readonly ProducedFileDiff[]): readonly ProducedFileDiff[];
