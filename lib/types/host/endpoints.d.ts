/**
 * 宿主适配层·同源 HTTP 端点。
 *
 * 注册六个 `/shadow-rewind` 端点（全部只服务本机回环，非回环一律 403）：
 *  - `/shadow-rewind`          GET 预览（消息/回合两种寻址）+ POST 执行恢复；
 *  - `/shadow-rewind/file`     从检查点（或当前磁盘 'live'）读单文件内容；
 *  - `/shadow-rewind/fs-changes` 批量返回会话所有轮次的文件系统变更；
 *  - `/shadow-rewind/trace`    轨迹时间线 + 区间 diff（轨迹重放 / 快照对比）；
 *  - `/shadow-rewind/restore-undo` 撤销该工作区最近一次恢复（B1 单次 undo）；
 *  - `/shadow-rewind/status`   最近错误环形缓冲 + 生效后端健康度。
 *
 * 消息→检查点解析、轮配对与行数统计分别在 session-resolve / fs-changes；
 * 本文件只负责请求解析、装配调用与响应形状。
 */
import type { ShadowRewindEngine } from '../engine.js';
import type { Request, Response } from './http-utils.js';
import type { RewindHttpDeps } from './types.js';
import type { TurnCheckpointCoordinator } from './coordinator.js';
import type { SettingsBridge } from './settings-bridge.js';
/** 同源端点根路径（客户端侧 fetch 的事实标准）。 */
export declare const REWIND_HTTP_PATH = "/shadow-rewind";
/** 注册同源端点；非回环请求一律 403（与旧插件同一安全边界）。
 * bridge 支持传解析函数：settings 桥异步装配到位前为 undefined，handler
 * 每次请求时重新解析（桥缺席时 config 端点按只读应答）。
 * 宿主 ctx 提供 effect 时，注册 disposer 挂进插件 fiber——插件禁用/HMR
 * 时端点随 fiber 注销（verify-host 门禁断言卸载清零）。 */
export declare function installShadowRewindHttp(ctx: RewindHttpDeps & {
    effect?: (dispose: () => void, label?: string) => void;
    webServer?: {
        register(route: {
            kind: 'exact';
            path: string;
            handler: (request: Request, response: Response) => Promise<void>;
        }): () => void;
    };
}, engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, bridge?: SettingsBridge | (() => SettingsBridge | undefined)): void;
