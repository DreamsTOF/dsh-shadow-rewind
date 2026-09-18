/**
 * 聊天面（`file-review` 命名空间）的 zh / en 字典：live 条 + 悬停 diff 浮层。
 *
 * 英文是键集的唯一真相来源：添加文案必须先动 `en`，再补 `zh`——缺键时
 * `t()` 回落到英文，反过来则会裸露键名给用户看。
 */
/** 本插件在 DSH 语言注册表里拥有的字典命名空间。 */
export declare const NS = "file-review";
/** 英文字典（键集的唯一真相来源）。 */
export declare const en: {
    'produced.open': string;
    'produced.dir': string;
    'produced.undoSuccess': string;
    'produced.redoSuccess': string;
    'review.copy': string;
    'review.copied': string;
    'review.showUnchanged': string;
    'review.hideUnchanged': string;
    'review.hunkN': string;
    'review.hunkInclude': string;
    'review.stats': string;
    'live.session': string;
    'live.audit': string;
    'live.undoRow': string;
    'live.redoRow': string;
    'live.undone': string;
    'live.conflict': string;
    'live.failed': string;
    'live.unavailable': string;
    'live.deleted': string;
    'live.ownerMulti': string;
    'live.ownerSession': string;
    'live.ownerUnknown': string;
};
/** 本命名空间全部字典键的联合类型。 */
export type DeliverablesKey = keyof typeof en;
/** 简体中文字典（`Record` 约束保证与英文键集一一对应，漏翻即编译报错）。 */
export declare const zh: Record<DeliverablesKey, string>;
