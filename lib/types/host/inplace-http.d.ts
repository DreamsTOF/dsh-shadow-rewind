import { type RewindHttpDeps } from './types.js';
import type { Request, Response } from './http-utils.js';
/** 就地遮蔽需要的最小 agent 面（结构类型）。 */
export interface InPlaceAgentLike {
    readonly id: string;
    readonly status?: string;
    cancel?(options: {
        readonly kind: 'user';
    }, flags?: {
        readonly keepInbox?: boolean;
    }): unknown;
    whenIdle?(): Promise<unknown>;
    readonly inbox?: {
        readonly nextStep?: readonly {
            readonly id: string;
        }[];
        remove?(id: string): unknown;
    };
    readonly session: {
        readonly id: string;
        /** dsh 0.1.2 核心 Session 的有序模型表面。 */
        readonly surface?: {
            readonly nodes?: readonly number[];
        };
        append?(type: 'user/message', data: {
            readonly content: readonly unknown[];
            readonly source: {
                readonly kind: 'plugin';
                readonly plugin: string;
            };
        }, options: {
            readonly surfaceOp: {
                readonly op: 'replace';
                readonly start: number;
                readonly end: number;
            };
            readonly sourceEventSeqs: readonly number[];
        }): {
            readonly seq: number;
        };
        readonly events?: readonly unknown[];
        readonly snapshotEvents?: () => readonly unknown[];
    };
}
/** 一次就地遮蔽的结果（HTTP 200 body 的 status 语义）。 */
export type InPlaceMaskOutcome = {
    readonly kind: 'ok';
    readonly markerSeq: number;
    readonly text: string;
} | {
    readonly kind: 'error';
    readonly text: string;
};
/** 执行就地遮蔽（append 标记）。文件恢复不在本层。 */
export declare function executeInPlaceMask(agent: InPlaceAgentLike, targetSeq: number, signal?: AbortSignal): Promise<InPlaceMaskOutcome>;
/** POST /shadow-rewind/inplace：在 live agent 的会话上执行就地遮蔽。 */
export declare function handleInPlaceHttp(deps: RewindHttpDeps, request: Request, response: Response): Promise<void>;
