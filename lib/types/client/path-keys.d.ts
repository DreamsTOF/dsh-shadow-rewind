/**
 * 路径键/文本原语叶子模块（无依赖）——供 session-changes / turn-deliverables /
 * rewound-changes / review-state 等共享，消除「反斜杠归一 + `./` 折叠 + basename」
 * 在多个文件各自复制导致的遮蔽键/合并键不一致。
 */
/** 反斜杠统一成正斜杠（Windows 工具路径 vs 服务端正斜杠是同一文件）。 */
export declare function pathKey(path: string): string;
/** 反斜杠归一（pathKey 别名：需要归一但语义强调「只归一不折叠」的场景）。 */
export declare function normalizePath(path: string): string;
/**
 * 行合并键：归一斜杠、去 `./` 前缀、绝对路径若落在会话工作区目录下折成相对
 * 路径。同一文件在「工具 meta 绝对路径 / fs 端点相对路径 / ./x 拼写」之间
 * 摆动时收成一行；目录不同的同名文件不会误并。live 条与审查面板共用。
 */
export declare function canonicalKey(path: string, cwd: string | undefined): string;
/** 路径末段——一眼就能认出文件的那一部分。 */
export declare function basename(path: string): string;
/** 从 user/steering 消息内容里抽取文本（text 块拼接；join 分隔符由调用方约定）。 */
export declare function textBlocksOf(content: readonly unknown[] | undefined): string[];
