/** `candidate` 是否等于或位于 `root` 之下（两者都应是规范绝对路径）。 */
export declare function isWithin(root: string, candidate: string): boolean;
/**
 * 校验并规范化一个工作区相对路径（纯字符串检查，不碰文件系统）。
 * 绝对路径、`.`/`..`/空段、NUL、Windows 反斜杠一律拒绝——持久化的每一条
 * 路径都必须先过这道闸，防止畸形数据在恢复时被 normalize 成合法路径逃逸。
 */
export declare function validateRelativePath(path: string): string;
/** 把已校验的相对路径解析到 `root` 之下；再次断言 containment。 */
export declare function resolveWorkspacePath(root: string, path: string): string;
/** 展开 `~` 前缀到指定 home 目录。 */
export declare function expandHome(path: string, home: string): string;
/** 把已存在的目录 realpath 规范化；非目录或不存在则报错。 */
export declare function canonicalDirectory(path: string): Promise<string>;
/** 原子写 JSON（临时文件 + rename），目录权限 0700、文件 0600。 */
export declare function writeJsonAtomic(path: string, value: unknown): Promise<void>;
/** 读取并解析一个 JSON 文件。 */
export declare function readJson(path: string): Promise<unknown>;
/** 路径是否存在（不跟随末级符号链接）。 */
export declare function pathExists(path: string): Promise<boolean>;
/**
 * 确保目标的每一段已存在父目录都是真实目录、绝无符号链接。
 * 恢复路径的父链若被符号链接劫持，写回就会逃逸出工作区——这是安全硬闸。
 */
export declare function ensureSafeParents(root: string, target: string): Promise<void>;
/** 校验已有父目录（不创建缺失目录），apply 前的计划复核用。 */
export declare function assertSafeParents(root: string, target: string): Promise<void>;
/** 用同级临时文件把一个路径替换为普通文件（写 → fsync → rename → chmod）。 */
export declare function replaceRegularFile(path: string, content: Buffer, mode: number): Promise<void>;
/** 用同级临时名把一个路径替换为符号链接。 */
export declare function replaceSymbolicLink(path: string, target: string): Promise<void>;
/**
 * 删除一个文件/符号链接，或一个「空」目录。
 * 拒绝删除非空目录——目录内容的清空只能由逐文件恢复完成，这里绝不递归。
 */
export declare function removeRestoreTarget(path: string): Promise<void>;
/** 从 `start` 向上尽力删除空目录，直到（不含）`root`。 */
export declare function pruneEmptyParents(root: string, start: string): Promise<void>;
/** 测试进程 id 是否仍然存在（lock 回收判定用）。 */
export declare function processExists(pid: number): boolean;
/** Node 错误的类型守卫：带指定 `code`。 */
export declare function isNodeError(error: unknown, code: string): boolean;
/** 平台支持时 flush 目录项变更（Windows/部分 FS 不支持则静默跳过）。 */
export declare function syncDirectory(path: string): Promise<void>;
/** 列出一层目录里的普通文件名（不存在 → 空数组）。 */
export declare function safeFileNames(path: string): Promise<string[]>;
/** 列出一层目录里的子目录名（不存在 → 空数组）。 */
export declare function safeDirectoryNames(path: string): Promise<string[]>;
