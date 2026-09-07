/**
 * 本地快速应用：一条龙执行 pnpm install → pnpm build → 把构建产物直灌进
 * DSH profile 的插件安装目录，跳过 npm publish + dsh plugin update 的发布
 * 链路。若插件尚未注册进 profile（dependencies + dsh.profile.bundles）则
 * 按官方 dsh plugin add 的对账语义补写——这样全新 profile 直接首装本地版，
 * 不必经过会拉 registry 旧版的 dsh plugin add。目标目录不存在时自动创建。
 * 只同步 files 白名单内容（lib / cordis.patch.yml / README.md / package.json），
 * 目标目录的其余部分（嵌套 node_modules 等）原样保留——依赖仍从 profile 顶层
 * 解析，与 registry 正式安装完全同语义。同步后重启 DSH 生效。
 *
 * 用法：pnpm apply
 *      node scripts/apply-local.mjs
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const profile = process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'web')
const target = join(profile, 'node_modules', 'dsh-shadow-rewind')

/** 顺序执行一条命令并继承 stdio，非零退出即中止。 */
function run(command) {
  const { status } = spawnSync(command, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (status !== 0) process.exit(status ?? 1)
}

// 1. install：装齐工作区依赖（全新 clone 直接可用）。
run('pnpm install')
// 2. build：产物进 lib/。
run('pnpm run build')

// 3. 注册：与 dsh plugin add 的对账语义一致（apps/cli/src/plugin.ts
// reconcilePlugins）——dependencies 里存在且包声明 dsh.bundle.patch 即追加进
// dsh.profile.bundles。已有条目不覆写（保留用户可能指定的版本区间/来源），
// 避免下次 profile 层 pnpm install 反复覆盖本地构建。
const manifestPath = join(profile, 'package.json')
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.dsh ??= { profile: { bundles: [] } }
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
let dirty = false
if (!(name in manifest.dependencies)) {
  manifest.dependencies[name] = `^${version}`
  dirty = true
}
if (!manifest.dsh.profile.bundles.includes(name)) {
  manifest.dsh.profile.bundles.push(name)
  dirty = true
}
if (dirty) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`[apply-local] 已注册进 ${manifestPath}`)
}

// 4. 同步产物：目标不存在则先建目录；先删后拷 = 镜像语义：源里已删除的
// 模块不会在目标里残留。目标是符号链接时（如插件目录直接链到本仓库），
// 源与目标同体——先删后拷会自毁源产物，同体跳过即产物已在位。
// 目标是悬空的符号链接/junction（仓库搬家后旧目标失效）时，
// Windows 上 mkdirSync 会报 ENOENT，先摘除链接本身。
try {
  readlinkSync(target) // 非链接条目抛 EINVAL，不存在抛 ENOENT，均交给下面 mkdirSync 处理
  if (!existsSync(target)) rmSync(target)
} catch {}

mkdirSync(target, { recursive: true })

/** 镜像复制一个产物条目；源与目标同体（符号链接安装）时跳过。 */
function copyAsset(name) {
  const dest = join(target, name)
  if (existsSync(dest) && realpathSync(dest) === realpathSync(name)) return
  rmSync(dest, { recursive: true, force: true })
  cpSync(name, dest, { recursive: true })
}

for (const name of ['lib', 'cordis.patch.yml', 'README.md', 'package.json']) copyAsset(name)

const at = statSync(join(target, 'lib', 'client.js')).mtime.toISOString()
console.log(`[apply-local] 已同步到 ${target}`)
console.log(`[apply-local] client.js 构建时间 ${at}；重启 DSH 生效。`)
