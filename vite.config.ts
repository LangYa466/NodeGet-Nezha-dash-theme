import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

const tryGit = (cmd: string) => {
  try {
    return execSync(cmd, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

const readGitDir = (): { sha: string; date: string } => {
  try {
    const gitDir = resolve(__dirname, '.git')
    const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim()
    const sha = head.startsWith('ref:')
      ? readFileSync(resolve(gitDir, head.slice(5).trim()), 'utf8').trim()
      : head
    return { sha, date: '' }
  } catch {
    return { sha: '', date: '' }
  }
}

const envSha =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.COMMIT_REF ||
  process.env.CF_PAGES_COMMIT_SHA ||
  ''
const envDate = process.env.VERCEL_GIT_COMMIT_AUTHOR_DATE || ''

const gitDirInfo = envSha ? { sha: '', date: '' } : readGitDir()

const commitSha = envSha || tryGit('git rev-parse HEAD') || gitDirInfo.sha
const commitDate = envDate || tryGit('git log -1 --format=%cI') || gitDirInfo.date

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commitSha),
    __APP_COMMIT_DATE__: JSON.stringify(commitDate),
  },
})
