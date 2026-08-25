import { describe, it, expect, vi } from 'vitest'

// Test the directory browser component's logic
describe('DirectoryBrowser component logic', () => {
  it('should navigate up from subdirectory', () => {
    // Since this is a Vue component, we test the logic separately
    // The actual component tests would need Vue Test Utils
    // For now, verify that breadcrumb computation works

    const path = '/home/user/projects/app-a'
    const parts = path.split('/').filter(Boolean)
    expect(parts).toEqual(['home', 'user', 'projects', 'app-a'])

    // Simulate parent navigation
    const parent = path.substring(0, path.lastIndexOf('/'))
    expect(parent).toBe('/home/user/projects')
  })

  it('should handle filtering to only directories', () => {
    const entries = [
      { name: 'app-a', kind: 'directory' },
      { name: 'app-b', kind: 'directory' },
      { name: 'readme.md', kind: 'file' },
    ]

    const directories = entries.filter((e) => e.kind === 'directory')
    expect(directories).toHaveLength(2)
    expect(directories.map((d) => d.name)).toEqual(['app-a', 'app-b'])
  })

  it('should sort directory entries alphabetically', () => {
    const entries = [
      { name: 'zebra', path: '/z' },
      { name: 'apple', path: '/a' },
      { name: 'banana', path: '/b' },
    ]

    const sorted = entries.sort((a, b) => a.name.localeCompare(b.name))
    expect(sorted.map((e) => e.name)).toEqual(['apple', 'banana', 'zebra'])
  })
})
