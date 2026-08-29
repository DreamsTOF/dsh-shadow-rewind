//#region src/types.ts
/** 影子回退（shadow-rewind）的共享类型：持久化格式、插件配置与对外结果。 */
/** 持久化格式版本。读取方拒绝一切其它版本（fail-closed，不做最佳努力兼容）。 */
const FORMAT_VERSION = 1;
//#endregion
export { FORMAT_VERSION };
