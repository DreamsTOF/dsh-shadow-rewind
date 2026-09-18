/**
 * 文件审查面（侧边栏/审计抽屉）的最小 zh / en 文案层。
 *
 * 走 DSH 的 i18n 体系：客户端 apply 通过 `attachLocale` 挂上语言服务
 * （`ctx.locale`，由 `@deepseek-ai/dsh-client-locale` 提供），`t()` 从它
 * 读取当前语言；没有挂载服务时（独立 / 测试装配）退回浏览器语言。整体沿用
 * dsh-better-sidebar 的 locales 模式。
 *
 * 与聊天面（`chat-locales.ts`）的键集来源相反：这一份以 `zh` 为真相来源。
 */
/** 本插件在 DSH 语言注册表里拥有的字典命名空间。 */
export declare const LOCALE_NS = "fileReviewTab";
/** 中文字典（键集的唯一真相来源）。 */
export declare const zh: {
    readonly tabTitle: "文件审查";
    readonly empty: "本会话暂无文件改动";
    readonly remoteUnavailable: "文件审查服务不可用";
    readonly turn: "第 {n} 轮";
    readonly turnLive: "进行中";
    readonly files: "{count} 个文件";
    readonly filesOne: "1 个文件";
    readonly undo: "撤销";
    readonly redo: "重新应用";
    readonly undoing: "正在撤销…";
    readonly redoing: "正在重新应用…";
    readonly undoTurn: "撤销本轮";
    readonly redoTurn: "重新应用本轮";
    readonly toggleUnavailable: "没有可安全还原的文件";
    readonly stateUndone: "已撤销";
    readonly stateConflict: "内容冲突";
    readonly stateUnsupported: "不可还原";
    readonly stateError: "错误";
    readonly deleted: "已删除";
    readonly deletedHint: "该文件已被删除，内容已不存在，无法查看差异或撤销。";
    readonly dirBadge: "目录";
    readonly dirHint: "这是一个空目录的增删记录，没有文件内容可展示；撤销/重新应用将重建或移除该目录。";
    readonly undoSuccess: "已成功撤销更改";
    readonly redoSuccess: "已成功重新应用更改";
    readonly undoPartial: "部分文件未能撤销";
    readonly redoPartial: "部分文件未能重新应用";
    readonly conflictTitle: "部分文件无法正常回滚";
    readonly conflictHint: "以下文件在本次变更之后又被修改过（可能与你的手动修改有关）。「全部回滚」会覆盖这些修改；「只回滚正常部分」会跳过它们，之后可对剩余文件再次操作。";
    readonly conflictAbort: "拒绝";
    readonly conflictForce: "全部回滚";
    readonly conflictPartial: "只回滚正常部分";
    readonly toggleError: "操作失败";
    readonly openInEditor: "在编辑器中打开";
    readonly copy: "复制差异";
    readonly copied: "已复制";
    readonly showUnchanged: "显示 {count} 行未更改内容";
    readonly hideUnchanged: "隐藏 {count} 行未更改内容";
    readonly stats: "新增 {added} 行，删除 {removed} 行";
    readonly unavailable: "无法为此更改还原可审查的差异。";
    readonly refresh: "刷新状态";
    readonly hunkN: "块 {n}";
    readonly hunkInclude: "勾选：参与下一次撤销/重新应用；取消勾选：保留该块不动";
    readonly hunkNoneSelected: "未选中任何改动块";
    readonly snapshotRestore: "快照恢复";
    readonly snapshotRestoreTitle: "把整个工作区恢复到这一轮开始之前（jj 影子快照）";
    readonly ownerMulti: "双方都改过";
    readonly ownerSession: "会话 {id}";
    readonly ownerUnknown: "来源不明";
    readonly turnOtherSessions: "含其它会话写入 {count}";
    readonly timeline: "时间线";
    readonly timelineTitle: "修改时间线";
    readonly timelineHint: "这是本会话中改动过这个文件的每一轮；点击行末的 +/− 统计可跳到那一轮的差异。";
    readonly timelineEmpty: "本会话没有这个文件的改动记录";
    readonly timelineNoDiff: "无差异文本";
    readonly viewDiff: "查看第 {n} 轮的差异";
    readonly close: "关闭";
};
/** 本命名空间全部字典键的联合类型。 */
export type CopyKey = keyof typeof zh;
/** 英文字典（`Record` 约束保证与中文键集一一对应，漏翻即编译报错）。 */
export declare const en: Record<CopyKey, string>;
/** 挂上（传 undefined 即摘下）DSH 语言服务。 */
export declare function attachLocale(service: {
    getSnapshot(): {
        active: string;
    };
} | undefined): void;
/** 翻译一个文案键；`{name}` 占位符由 `params` 插值填充。 */
export declare function t(key: CopyKey, params?: Record<string, string | number>): string;
