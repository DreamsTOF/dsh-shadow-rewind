/**
 * dsh-shadow-rewind —— 浏览器半边的「会话回退」面。
 *
 * 职责：给每条直发用户消息挂「恢复到发送之前」入口，打开统一恢复弹窗
 * RewindDialog（消息按钮与审计面板「从快照恢复此轮」共用同一份预览数据）。
 * 唯一语义：**整树恢复到该检查点，丢弃其后的一切写盘**（含终端/外部与手动
 * 修改）；消息入口同时就地遮蔽该消息及其后的对话行并把文本放回输入框。
 *
 * 全部走客户端公开服务（slots / sessions / conversation），宿主半边不注入
 * 任何上下文；文件恢复的真正执行与安全闸都在引擎侧。
 */
import * as React from 'react';
import type { Context } from '@deepseek-ai/cordis';
/** 一条可回退的直发用户消息锚点。 */
interface RewindMatched {
    readonly messageSeq: number;
    readonly promptText: string;
}
/**
 * 统一恢复弹窗（RewindDialog）的寻址：消息按钮带 messageSeq（三种模式全可用），
 * 审计面板「从快照恢复此轮」带 turn（宿主约束：只支持只恢复文件）。两种寻址
 * 共用同一份预览数据（preview-http 共享加载器）。
 */
export type RewindDialogTarget = RewindMatched | {
    readonly turn: number;
};
export declare const rewindInject: string[];
export declare function rewindApply(ctx: Context): void;
export interface RewindDialogProps {
    readonly sessionId: string;
    /** 统一寻址：消息按钮 = RewindMatched；审计面板「从快照恢复此轮」= { turn }。 */
    readonly target: RewindDialogTarget;
    /** 点某行的 +/- 就地跳到该文件 diff（审计面板内打开时提供）；缺省经
     * audit-open 总线交给 live 条开全屏审查并深链。 */
    readonly onJumpToDiff?: (path: string) => void;
    readonly onClose: () => void;
}
export declare function RewindDialog({ sessionId, target, onJumpToDiff, onClose }: RewindDialogProps): React.DetailedReactHTMLElement<{
    className: string;
    role: "dialog";
    'aria-modal': "true";
}, HTMLElement>;
export {};
