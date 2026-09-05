/**
 * 扁平路径清单 → 可折叠目录树（纯函数）。
 * 借鉴 dsh-checkpoint-diff 的 lib/tree.js（MIT）思路：按 / 分段建 trie，
 * 单链目录折叠（"src" 与 "src/lib" 只剩一个中间目录时合并为 "src/lib"），
 * 目录节点聚合子路径计数。
 */
/** 树节点：目录（children 非空，path 为折叠后的完整目录前缀）或文件（path 为完整路径）。 */
export interface DirTreeNode {
    /** 显示名：文件名，或折叠后的多级目录名（如 "src/lib"）。 */
    readonly name: string;
    /** 完整路径：文件 = 原路径；目录 = 折叠链的目录前缀。 */
    readonly path: string;
    /** 子节点（目录才有）。 */
    readonly children?: readonly DirTreeNode[];
}
/** 构建目录树。输入路径顺序 = 输出同层顺序（不重排，保持上游排序）。 */
export declare function buildDirTree(paths: readonly string[]): readonly DirTreeNode[];
/** 目录节点聚合的文件数（含子目录内；纯函数）。 */
export declare function countLeafFiles(nodes: readonly DirTreeNode[]): number;
