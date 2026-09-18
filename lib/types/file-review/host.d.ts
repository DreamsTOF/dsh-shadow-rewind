/**
 * 宿主半边的文件审查装配（自 dsh-file-review-tab 移植）：
 *  1. FileReviewService —— hunk 级撤销/重做，发布为 Typert `fileReview` 命名空间；
 *  2. 最终回复的文件引用引导（浏览器端行内代码文件提及的配对渲染契约）。
 *
 * 变更事实的唯一来源是检查点 diff：Code Mode（run_code）的嵌套写盘同样落在
 * 轮末检查点里，不需要宿主侧另行录制。
 */
import type { Context } from '@deepseek-ai/cordis';
import { FileReviewService } from './file-review-service.ts';
export type * from './change-types.ts';
export { FileReviewService, transformFile } from './file-review-service.ts';
export interface InstallFileReviewHostOptions {
    /** 存储根（shadow-rewind 存储根）；删除类 fs 撤销的安全网副本落在其下。 */
    readonly storageDir?: string;
}
/**
 * 在插件宿主上下文里装配全部文件审查能力，返回创建的 FileReviewService。
 * @param ctx - 宿主 cordis 上下文（携带 system-prompt 注册表）。
 */
export declare function installFileReviewHost(ctx: Context, options?: InstallFileReviewHostOptions): FileReviewService;
