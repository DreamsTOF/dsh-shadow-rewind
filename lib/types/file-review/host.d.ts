/**
 * 宿主半边的文件审查装配（自 dsh-file-review-tab 移植）：
 *  1. FileReviewService —— hunk 级撤销/重做，发布为 Typert `fileReview` 命名空间；
 *  2. 最终回复的文件引用引导（浏览器端行内代码文件提及的配对渲染契约）；
 *  3. Code Mode（run_code）嵌套派发的修改录制器 —— 嵌套调用在会话快照里没有
 *     wire 视图，必须在宿主侧快照 before/after 才能回放 diff；
 *  4. 便携增强：录制记录持久化到 shadow-rewind 的存储目录（原插件为纯内存，
 *     宿主重启后 Code Mode 轮次的 diff 与撤销会静默丢失）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { FileReviewService } from './file-review-service.ts';
export type * from './change-types.ts';
export { FileReviewService, transformFile } from './file-review-service.ts';
export interface InstallFileReviewHostOptions {
    /** 录制记录持久化目录（shadow-rewind 存储根）；缺省时保持纯内存。 */
    readonly storageDir?: string;
}
/**
 * 在插件宿主上下文里装配全部文件审查能力，返回创建的 FileReviewService。
 * @param ctx - 宿主 cordis 上下文（携带 system-prompt 注册表与工具瀑布）。
 */
export declare function installFileReviewHost(ctx: Context, options?: InstallFileReviewHostOptions): FileReviewService;
//# sourceMappingURL=host.d.ts.map