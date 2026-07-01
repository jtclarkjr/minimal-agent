import path from 'node:path'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

const defaultRepoRoot = '/Users/jamesclark/GitHub'
const repoRoot = process.env.EVE_HOST_REPO_ROOT ?? defaultRepoRoot
let realRepoRoot: Promise<string> | undefined

const inputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list'),
    path: z.string().min(1),
    maxDepth: z.number().int().min(1).max(5).default(2),
    maxEntries: z.number().int().min(1).max(1000).default(250),
    includeHidden: z.boolean().default(false)
  }),
  z.object({
    action: z.literal('read'),
    path: z.string().min(1),
    startLine: z.number().int().min(1).default(1),
    maxLines: z.number().int().min(1).max(1000).default(200),
    maxBytes: z.number().int().min(1).max(250_000).default(120_000)
  })
])

type Entry = {
  path: string
  type: 'directory' | 'file' | 'symlink' | 'other'
  size?: number
}

export default defineTool({
  description:
    'Read-only access to local repositories under /Users/jamesclark/GitHub. Use this for absolute local repo paths; the default sandbox tools only see /workspace.',
  inputSchema,
  async execute(input) {
    if (input.action === 'list') {
      const maxDepth = input.maxDepth ?? 2
      const maxEntries = input.maxEntries ?? 250
      const includeHidden = input.includeHidden ?? false
      const target = await resolveAllowedPath(input.path)
      const targetStat = await stat(target.absolutePath)
      if (!targetStat.isDirectory()) {
        throw new Error(`Not a directory: ${target.displayPath}`)
      }

      const entries: Entry[] = []
      await walkDirectory({
        absolutePath: target.absolutePath,
        root: target.root,
        remainingDepth: maxDepth,
        maxEntries,
        includeHidden,
        entries
      })

      return {
        root: target.root,
        path: target.displayPath,
        entries,
        truncated: entries.length >= maxEntries
      }
    }

    const startLine = input.startLine ?? 1
    const maxLines = input.maxLines ?? 200
    const maxBytes = input.maxBytes ?? 120_000
    const target = await resolveAllowedPath(input.path)
    const targetStat = await stat(target.absolutePath)
    if (!targetStat.isFile()) {
      throw new Error(`Not a file: ${target.displayPath}`)
    }

    const byteLimit = Math.min(maxBytes, targetStat.size)
    const handle = await open(target.absolutePath, 'r')
    try {
      const buffer = Buffer.alloc(byteLimit)
      const { bytesRead } = await handle.read(buffer, 0, byteLimit, 0)
      const content = buffer.subarray(0, bytesRead)

      if (content.includes(0)) {
        throw new Error(`Refusing to read likely binary file: ${target.displayPath}`)
      }

      const lines = content.toString('utf8').split(/\r?\n/)
      const startIndex = startLine - 1
      const selected = lines.slice(startIndex, startIndex + maxLines)
      const numbered = selected.map((line, index) => `${startLine + index}: ${line}`).join('\n')

      return {
        path: target.displayPath,
        startLine,
        endLine: startLine + selected.length - 1,
        content: numbered,
        truncated: targetStat.size > byteLimit || startIndex + selected.length < lines.length - 1
      }
    } finally {
      await handle.close()
    }
  }
})

async function getRealRepoRoot() {
  realRepoRoot ??= realpath(repoRoot)
  return realRepoRoot
}

async function resolveAllowedPath(inputPath: string) {
  const root = await getRealRepoRoot()
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.join(root, inputPath)
  const resolvedPath = await realpath(absolutePath)

  if (!isInsideRoot(resolvedPath, root)) {
    throw new Error(`Path is outside allowed repo root: ${repoRoot}`)
  }

  return {
    root,
    absolutePath: resolvedPath,
    displayPath: path.relative(root, resolvedPath) || '.'
  }
}

function isInsideRoot(targetPath: string, root: string) {
  const relativePath = path.relative(root, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

async function walkDirectory(options: {
  absolutePath: string
  root: string
  remainingDepth: number
  maxEntries: number
  includeHidden: boolean
  entries: Entry[]
}) {
  if (options.entries.length >= options.maxEntries) return

  const children = await readdir(options.absolutePath, { withFileTypes: true })
  children.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })

  for (const child of children) {
    if (options.entries.length >= options.maxEntries) return
    if (!options.includeHidden && child.name.startsWith('.')) continue

    const childPath = path.join(options.absolutePath, child.name)
    const childStat = await lstat(childPath)
    const type = child.isDirectory()
      ? 'directory'
      : child.isFile()
        ? 'file'
        : child.isSymbolicLink()
          ? 'symlink'
          : 'other'

    options.entries.push({
      path: path.relative(options.root, childPath),
      type,
      size: type === 'file' ? childStat.size : undefined
    })

    if (type === 'directory' && options.remainingDepth > 1) {
      await walkDirectory({
        ...options,
        absolutePath: childPath,
        remainingDepth: options.remainingDepth - 1
      })
    }
  }
}
