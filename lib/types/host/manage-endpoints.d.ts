/**
 * 宿主适配层·配置与管理端点（ABSORB-RECALL 1.3 / 三 / 四）。
 *
 *  - `/shadow-rewind/config`  GET 全量配置（resolved + 用户覆盖 + env 锁）
 *                             + POST {patch} / {op:'reset'} 写 settings 用户层；
 *  - `/shadow-rewind/manage`  GET 工作区→会话→检查点三级树 + 磁盘占用，
 *                             POST 删除（单条/会话/全部）、立即 GC。
 *
 * 全部只服务本机回环（与其余 /shadow-rewind 端点同一安全边界）。
 * 管理树不分页：每会话检查点有硬配额（30×2 相位），自用规模树全量返回。
 */
import type { ShadowRewindEngine } from '../engine.js';
import type { SettingsBridge } from './settings-bridge.js';
import type { Request, Response } from './http-utils.js';
export declare const MANAGE_HTTP_PATH = "/shadow-rewind/manage";
export declare const CONFIG_HTTP_PATH = "/shadow-rewind/config";
/** GET+POST /shadow-rewind/config：配置读取 / 写入 / 重置。 */
export declare function handleConfigHttp(engine: ShadowRewindEngine, bridge: SettingsBridge | undefined, request: Request, response: Response): Promise<void>;
/** GET+POST /shadow-rewind/manage：检查点管理树、磁盘占用、删除与手动 GC。 */
export declare function handleManageHttp(engine: ShadowRewindEngine, request: Request, response: Response): Promise<void>;
