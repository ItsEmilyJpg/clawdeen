import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /*
     * A worktree of another session lives under .claude and carries a copy of these tests. Run from
     * here they share the fixture paths in /tmp with this tree's run and delete each other's files,
     * so a check goes red over work that is not in this tree at all.
     */
    exclude: [...configDefaults.exclude, '.claude/**']
  }
})
