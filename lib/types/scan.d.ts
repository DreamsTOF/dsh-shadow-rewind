import type { SkippedPath } from './types.js';
/** 扫描产出的单个路径事实（内容在引擎阶段再读）。 */
export interface ScannedPath {
    readonly path: string;
    readonly kind: 'file' | 'symlink';
    /** 符号链接的 target（kind === 'symlink' 时有值）。 */
    readonly target?: string;
    readonly size: number;
    readonly mode: number;
    /** 以下 stat 字段供增量同步缓存做指纹比对。 */
    readonly mtimeNs: bigint;
    readonly ctimeNs: bigint;
    readonly dev: bigint;
    readonly ino: bigint;
}
/** 一次工作区扫描的结果。 */
export interface DirectoryScan {
    /** 规范化后的工作区根。 */
    readonly root: string;
    /** 入选路径，按字节序排序。 */
    readonly paths: readonly ScannedPath[];
    /** 可见但被显式跳过的路径，按 path 排序。 */
    readonly skipped: readonly SkippedPath[];
    /** 子树里没有任何入选路径的目录（空目录）；根目录不含在内，按 path 排序。
     * 快照据此记录纯目录的增删——非空目录由其子条目隐式表达，不重复记录。 */
    readonly emptyDirs: readonly {
        readonly path: string;
        readonly mode: number;
    }[];
}
/** 一条编译完成的排除规则。 */
export interface ExcludeRule {
    readonly pattern: string;
    readonly regex: RegExp;
}
/**
 * 把一条排除 glob 编译成工作区相对路径的正则。
 *  - 含 `*` 或 `?` 的按 glob 语义：单个 `*` 不跨段，`**` 可匹配任意层级；
 *  - 字面相对路径（如 `node_modules`）视为目录规则：匹配任意层级下的同名
 *    节点及其全部内容——这是配置里最常用的写法。
 */
export declare function compileExclude(pattern: string): ExcludeRule;
/** 编译整张排除清单。 */
export declare function compileExcludes(patterns: readonly string[]): readonly ExcludeRule[];
/** 工作区相对路径（目录传 `dir/` 形式）是否命中任一排除规则。 */
export declare function matchesExclude(rel: string, rules: readonly ExcludeRule[]): boolean;
/**
 * 遍历工作区目录树：
 *  - 命中目录规则的整棵剪枝（不递归进入）；
 *  - 命中文件规则的文件直接省略；
 *  - 特殊文件 / 超限文件进入 skipped；
 *  - 符号链接不跟随、不下钻。
 */
export declare function scanWorkspace(cwd: string, options: {
    readonly maxFileBytes: number;
    readonly excludes: readonly ExcludeRule[];
    readonly signal?: AbortSignal;
}): Promise<DirectoryScan>;
