import { parseManifest } from './manifest.js';
import type { ResolvedShadowRewindConfig } from './types.js';
/** fork 谱系条目（ABSORB-RECALL 四）：childId 是 fork 出的新会话。 */
export interface LineageEntry {
    readonly childId: string;
    readonly parentId: string;
    /** 触发 fork的恢复点（「恢复并从新会话继续」的时点）。 */
    readonly restorePointId?: string;
    readonly time: number;
}
/** 每个工作区的全部持久化状态。 */
export declare class WorkspaceStore {
    private readonly config;
    constructor(config: ResolvedShadowRewindConfig);
    /** 启动装配：确保存储根存在。历史遗留的操作日志文件不再读取——
     * 下一次 GC / 清理时自然过期，不做启动期迁移。 */
    initialize(): Promise<void>;
    /** 规范工作区 → 状态目录（binding 校验通过后）。 */
    workspaceDir(workspace: string): Promise<string>;
    writeManifest(workspace: string, manifest: Parameters<typeof parseManifest>[0]): Promise<void>;
    readManifest(workspace: string, id: string): Promise<ReturnType<typeof parseManifest>>;
    listManifests(workspace: string): Promise<readonly ReturnType<typeof parseManifest>[]>;
    deleteManifest(workspace: string, id: string): Promise<void>;
    /**
     * 影子仓库丢失重建后（K1）：旧 manifest 引用的 commit 已全部死亡——
     * 整目录清除全部清单。决策语义是「重建即清」：列表不再展示内容已失、
     * 恢复必败的恢复点（与其逐个标 degraded，不如诚实清空）。
     * 跳过记录不在此列：它只是提示。
     */
    purgeManifests(workspace: string): Promise<void>;
    /** 追加一条 fork 谱系（childId ↔ parentId）到工作区状态目录的
     * lineage.json。缺失/损坏按空表处理（谱系是展示性增强，不致命）；
     * 同一 (childId, parentId) 只记一次（fork 幂等）。 */
    appendLineage(workspace: string, entry: LineageEntry): Promise<void>;
    /** 读取 fork 谱系链；缺失/损坏返回空数组（按无谱系展示）。 */
    readLineage(workspace: string): Promise<LineageEntry[]>;
    /** 读上次 GC 时刻（gc.stamp，跨重启续存）；缺失/损坏返回 0（视为很久前）。 */
    readGcStamp(workspace: string): Promise<number>;
    /** 记录本次 GC 时刻。失败上抛由调用方静默（节流退化为每次都跑，不损正确性）。 */
    writeGcStamp(workspace: string, lastRunAt: number): Promise<void>;
    writeTurnSkip(workspace: string, skip: {
        sessionId: string;
        turn: number;
        turnStartSeq: number;
        reason: string;
    }): Promise<void>;
    readTurnSkip(workspace: string, sessionId: string, turn: number, turnStartSeq: number): Promise<{
        reason: string;
    } | undefined>;
    deleteTurnSkip(workspace: string, sessionId: string, turn: number, turnStartSeq: number): Promise<void>;
    private readonly sqliteDbs;
    /** 打开（或复用）工作区的快照内容库：单文件 SQLite（WAL + FULL），内容寻址。 */
    private sqliteDb;
    /**
     * 批量写入内容寻址 blob（单事务）。
     * ponytail: 整库单文件 + 内容寻址表；天花板是「跨工作区全局去重」与
     * 「增量压缩」，需要时再加全局库或 VACUUM 策略，当前单工作区去重已够。
     */
    putSqliteBlobs(workspace: string, items: readonly {
        readonly hash: string;
        readonly content: Buffer;
    }[]): Promise<void>;
    /** 缓存命中校验用：内容行是否确实存在于库（不读内容）。 */
    sqliteBlobExists(workspace: string, hash: string): Promise<boolean>;
    /** 读取并校验一个 blob。 */
    readSqliteBlob(workspace: string, hash: string): Promise<Buffer>;
    /** 删除未被任何 manifest 引用的内容行（只统计 sqlite 后端的引用）。 */
    collectGarbage(workspace: string): Promise<{
        deletedBlobs: number;
        retainedBlobs: number;
    }>;
    /** 关闭全部打开的 SQLite 句柄（受控关闭/测试清理用；幂等）。 */
    closeAll(): Promise<void>;
    /** 状态根必须不在被管理工作区内（防自吞）。 */
    assertStorageSeparated(workspace: string): Promise<void>;
}
/** 探测宿主机 `node:sqlite` 是否可用（一次性开销；Node ≥22.19 自带）。 */
export declare function sqliteAvailable(): boolean;
