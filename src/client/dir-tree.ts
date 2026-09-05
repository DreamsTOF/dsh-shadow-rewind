/**
 * 扁平路径清单 → 可折叠目录树（纯函数）。
 * 借鉴 dsh-checkpoint-diff 的 lib/tree.js（MIT）思路：按 / 分段建 trie，
 * 单链目录折叠（"src" 与 "src/lib" 只剩一个中间目录时合并为 "src/lib"），
 * 目录节点聚合子路径计数。
 */

/** 树节点：目录（children 非空，path 为折叠后的完整目录前缀）或文件（path 为完整路径）。 */
export interface DirTreeNode {
  /** 显示名：文件名，或折叠后的多级目录名（如 "src/lib"）。 */
  readonly name: string
  /** 完整路径：文件 = 原路径；目录 = 折叠链的目录前缀。 */
  readonly path: string
  /** 子节点（目录才有）。 */
  readonly children?: readonly DirTreeNode[]
}

interface TrieNode {
  readonly children: Map<string, TrieNode>
  /** 叶子 = 一个真实文件路径的终点。 */
  leaf: boolean
}

/** 构建目录树。输入路径顺序 = 输出同层顺序（不重排，保持上游排序）。 */
export function buildDirTree(paths: readonly string[]): readonly DirTreeNode[] {
  const root: TrieNode = { children: new Map(), leaf: false }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      let child = node.children.get(part)
      if (child === undefined) {
        child = { children: new Map(), leaf: false }
        node.children.set(part, child)
      }
      node = child
    }
    const name = parts[parts.length - 1]!
    node.children.set(name, { children: new Map(), leaf: true })
  }

  const collapse = (node: TrieNode, prefix: string): DirTreeNode[] => {
    const out: DirTreeNode[] = []
    for (const [name, child] of node.children) {
      const path = prefix === '' ? name : `${prefix}/${name}`
      if (child.leaf) {
        out.push({ name, path })
        continue
      }
      // 单链折叠：目录只有一个子目录（且不是叶子）时合并显示名。
      let dirName = name
      let cursor = child
      while (!cursor.leaf && cursor.children.size === 1) {
        const [nextName, nextNode] = [...cursor.children.entries()][0]!
        if (nextNode.leaf) break
        dirName = `${dirName}/${nextName}`
        cursor = nextNode
      }
      const dirPath = prefix === '' ? dirName : `${prefix}/${dirName}`
      out.push({ name: dirName, path: dirPath, children: collapse(cursor, dirPath) })
    }
    return out
  }
  return collapse(root, '')
}

/** 目录节点聚合的文件数（含子目录内；纯函数）。 */
export function countLeafFiles(nodes: readonly DirTreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    count += node.children === undefined ? 1 : countLeafFiles(node.children)
  }
  return count
}
