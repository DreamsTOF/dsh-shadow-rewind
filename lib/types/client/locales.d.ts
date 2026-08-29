/**
 * Minimal zh/en copy for the file-review sidebar tab. Follows the DSH i18n
 * system: the client apply attaches the locale service (`ctx.locale`,
 * provided by `@deepseek-ai/dsh-client-locale`) through {@link attachLocale},
 * and `t()` resolves the active locale from it. Without an attached service
 * (standalone/test compositions) the browser language is used. Mirrors the
 * dsh-better-sidebar locales pattern.
 */
/** The dictionary namespace this plugin owns in the DSH locale registry. */
export declare const LOCALE_NS = "fileReviewTab";
/** The zh dictionary (the key-set source of truth). */
export declare const zh: {
    readonly tabTitle: "文件审查";
    readonly empty: "本会话暂无文件改动";
    readonly sessionUnavailable: "会话不可用";
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
    readonly deletedHint: "该文件在本轮中被终端命令删除，内容已不存在，无法查看差异或撤销。";
    readonly undoSuccess: "已成功撤销更改";
    readonly redoSuccess: "已成功重新应用更改";
    readonly undoPartial: "部分文件未能撤销";
    readonly redoPartial: "部分文件未能重新应用";
    readonly toggleError: "操作失败";
    readonly openInEditor: "在编辑器中打开";
    readonly open: "打开 {name}";
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
    readonly snapshotDialogTitle: "从快照恢复此轮";
    readonly snapshotDialogWarn: "整树恢复会把工作区全部文件恢复到第 {n} 轮开始之前，影响范围不止下面列出的文件；已记录的块级撤销状态可能随之失效（显示为冲突）。";
    readonly snapshotLoading: "正在检查这一轮开始前的快照…";
    readonly snapshotMissing: "没有找到这一轮开始前的快照：可能当时未启用自动快照、记录已清理，或该轮快照失败/跳过。";
    readonly snapshotTotal: "将恢复 {count} 个文件";
    readonly snapshotNoChanges: "工作区已经是这一轮开始前的状态，无需恢复。";
    readonly snapshotBlocked: "这个项目目录还有别的对话正在运行。恢复文件会影响到它们，因此本次操作已被阻止。";
    readonly snapshotGatedRunning: "另有 {n} 个会话正在运行；其文件写入已被写入闸拒绝，不会影响本次恢复。";
    readonly gateOn: "闸：开";
    readonly gateOff: "闸：关";
    readonly gateUnknown: "闸：—";
    readonly gateTitleOn: "当前为准模式（写入闸开启）：同一工作区只有「当前」会话可写，恢复为整树；点击切换到对称模式（重启后回到配置初值）";
    readonly gateTitleOff: "对称模式（写入闸关闭）：所有会话都可并行写入，恢复时按归属勾选要还原的路径，运行中的会话会阻塞恢复；点击切换到当前为准模式（重启后回到配置初值）";
    readonly gateToggleFailed: "切换写入闸失败";
    readonly modeSymmetricHint: "对称模式：默认只勾选本会话改动的文件；勾选其它文件会把它们一并恢复到该时点。";
    readonly ownerMulti: "双方都改过";
    readonly ownerSession: "会话 {id}";
    readonly ownerUnknown: "来源不明";
    readonly selectAll: "全部选中（整树恢复）";
    readonly snapshotTotalSelected: "将恢复 {count} / {total} 个文件";
    readonly pathsTooLong: "勾选的文件过多，无法构造恢复请求；请减少勾选";
    readonly snapshotStale: "项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查。";
    readonly snapshotSkipped: "以下文件未纳入快照，恢复不会改动它们：";
    readonly snapshotRetry: "重新检查";
    readonly snapshotApply: "恢复文件";
    readonly snapshotApplying: "正在恢复…";
    readonly snapshotDone: "项目文件已恢复到该轮开始之前；对话保持不变。恢复前的文件已自动备份。";
    readonly snapshotFailed: "快照恢复失败";
    readonly kindAdded: "移除后来新增的文件";
    readonly kindDeleted: "找回文件";
    readonly kindModified: "恢复之前的版本";
    readonly kindModeChanged: "恢复文件权限";
    readonly kindTypeChanged: "恢复之前的文件类型";
    readonly skipTooLarge: "超过大小上限";
    readonly skipUnsupportedType: "文件类型不支持";
    readonly skipReadFailed: "读取失败";
    readonly close: "关闭";
    readonly cancel: "取消";
};
/** Union of this namespace's dictionary keys. */
export type CopyKey = keyof typeof zh;
/** The en dictionary. */
export declare const en: Record<CopyKey, string>;
/** Attach (or detach, with undefined) the DSH locale service. */
export declare function attachLocale(service: {
    getSnapshot(): {
        active: string;
    };
} | undefined): void;
/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export declare function t(key: CopyKey, params?: Record<string, string | number>): string;
//# sourceMappingURL=locales.d.ts.map