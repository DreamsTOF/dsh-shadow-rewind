import type { ProducedFileDiff } from '../file-review/change-types.ts';
/**
 * 一次文件变更的行级 hunk；文件是新建的（`before === null`）时返回单条整文件
 * 条目（oldText = null，撤销语义 = 删除文件）。变更没有实际改动文件时返回 []。
 */
export declare function diffsFromBeforeAfter(rawPath: string, rawBefore: string | null, rawAfter: string): readonly ProducedFileDiff[];
