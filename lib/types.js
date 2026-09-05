//#region src/types.ts
/** 影子回退（shadow-rewind）的共享类型：持久化格式、插件配置与对外结果。 */
/** 持久化格式版本。读取方拒绝一切其它版本（fail-closed，不做最佳努力兼容）。
* TODO: 版本演进策略——本插件自产自销该格式，bump 前必须先发布能读旧版本的
* 消费方。届时借鉴 dsh-checkpoint-diff 的「容错超集」方案：新 schema 把旧版
* 字段全部收为可选（严格性归生产者），open 按 version-mismatch 双版本回退，
* 而不是整介质作废。当前全部新增字段（intent 等）都以可选字段无痛演进，
* 不需要 bump。 */
const FORMAT_VERSION = 1;
//#endregion
export { FORMAT_VERSION };
