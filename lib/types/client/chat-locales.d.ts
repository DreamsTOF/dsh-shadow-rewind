/**
 * 聊天面（`file-review` 命名空间）的 zh / en 字典。
 *
 * 英文是键集的唯一真相来源：添加文案必须先动 `en`，再补 `zh`——缺键时
 * `t()` 回落到英文，反过来则会裸露键名给用户看。
 */
/** 本插件在 DSH 语言注册表里拥有的字典命名空间。 */
export declare const NS = "file-review";
/** 英文字典（键集的唯一真相来源）。 */
export declare const en: {
    'produced.summary': string;
    'produced.editedOne': string;
    'produced.edited': string;
    'produced.moreOne': string;
    'produced.more': string;
    'produced.open': string;
    'produced.review': string;
    'produced.reviewAll': string;
    'produced.undo': string;
    'produced.redo': string;
    'produced.undoFile': string;
    'produced.redoFile': string;
    'produced.undoing': string;
    'produced.redoing': string;
    'produced.toggleUnavailable': string;
    'produced.undoSuccess': string;
    'produced.redoSuccess': string;
    'produced.undoPartial': string;
    'produced.redoPartial': string;
    'produced.undoPartialDescription': string;
    'produced.redoPartialDescription': string;
    'produced.skippedFiles': string;
    'produced.undoError': string;
    'produced.redoError': string;
    'produced.noticeClose': string;
    'produced.noticeDismiss': string;
    'produced.deleted': string;
    'produced.dir': string;
    'produced.deletedOne': string;
    'produced.deletedAll': string;
    'review.title': string;
    'review.fileOne': string;
    'review.files': string;
    'review.close': string;
    'review.resize': string;
    'review.resizeHint': string;
    'review.openInEditor': string;
    'review.copy': string;
    'review.copied': string;
    'review.showUnchanged': string;
    'review.hideUnchanged': string;
    'review.hunkN': string;
    'review.hunkInclude': string;
    'review.stats': string;
    'review.unavailable': string;
    'live.changes': string;
    'live.deleted': string;
    'live.more': string;
};
/** 本命名空间全部字典键的联合类型。 */
export type DeliverablesKey = keyof typeof en;
/** 简体中文字典（`Record` 约束保证与英文键集一一对应，漏翻即编译报错）。 */
export declare const zh: Record<DeliverablesKey, string>;
