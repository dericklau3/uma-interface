import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
  const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
  const isGitHubPagesBuild =
    process.env.GITHUB_ACTIONS === 'true' || process.env.GITHUB_PAGES === 'true'

  return {
    base: isGitHubPagesBuild && repositoryName ? `/${repositoryName}/` : '/',
    plugins: [react()],
  }
})
