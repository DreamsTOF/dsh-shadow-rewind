/**
 * 就地遮蔽回退标记的常量与构造。
 *
 * 标记 = 一条**空内容**的 `user/message`，source 为 plugin；宿主经
 * `agent.session.append('user/message', marker, {surfaceOp:{op:'replace',
 * start,end}, sourceEventSeqs})` 落日志。空内容使它不带任何语言、不会污染
 * 模型输入；derive 到自身后作为 surface 尾部的「存在但为空」切断点。
 */
/** 标记 source 的插件标识（宿主侧按 sourceEventSeqs 识别自己写的标记）。 */
export declare const INPLACE_MARKER_PLUGIN = "dsh-shadow-rewind";
export declare const INPLACE_MARKER_SOURCE: {
    readonly kind: "plugin";
    readonly plugin: "dsh-shadow-rewind";
};
/** 空内容标记（append 时禁止复用同一引用，避免宿主修改污染常量）。 */
export declare const INPLACE_MARKER_CONTENT: readonly unknown[];
/** 构造一条可 append 的标记消息体（每次新对象）。 */
export declare function buildInPlaceMarker(): {
    readonly content: readonly unknown[];
    readonly source: {
        readonly kind: 'plugin';
        readonly plugin: string;
    };
};
