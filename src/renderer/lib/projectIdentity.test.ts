// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import {
  effectiveProjectColor,
  effectiveProjectName,
  pathBasename,
  projectFolderPath,
  renderableDerivedIcon
} from './projectIdentity'

const project = (over: Partial<Project>): Pick<Project, 'name' | 'cwd' | 'ssh'> => ({
  name: 'nodeterm',
  cwd: '/Users/bas/Development/Projects/nodeterm',
  ...over
})

describe('pathBasename', () => {
  it('takes the last segment for either separator, ignoring trailing ones', () => {
    expect(pathBasename('/srv/app/nodeterm')).toBe('nodeterm')
    expect(pathBasename('/srv/app/nodeterm/')).toBe('nodeterm')
    expect(pathBasename('C:\\code\\nodeterm')).toBe('nodeterm')
    expect(pathBasename('')).toBe('')
  })
})

describe('projectFolderPath', () => {
  it('prefers an SSH project’s remote cwd', () => {
    expect(projectFolderPath({ cwd: '/local', ssh: { remoteCwd: '/srv/app' } as never })).toBe(
      '/srv/app'
    )
    expect(projectFolderPath({ cwd: '/local' })).toBe('/local')
    expect(projectFolderPath({})).toBe('')
  })
})

describe('effectiveProjectName', () => {
  it('uses the derived name while the project still wears its folder basename', () => {
    expect(effectiveProjectName(project({}), 'Node Terminal')).toBe('Node Terminal')
  })

  it('never talks over a name the user chose', () => {
    expect(effectiveProjectName(project({ name: 'My fork' }), 'Node Terminal')).toBe('My fork')
  })

  it('keeps the project name when nothing was derived', () => {
    expect(effectiveProjectName(project({}), null)).toBe('nodeterm')
    expect(effectiveProjectName(project({}), undefined)).toBe('nodeterm')
    expect(effectiveProjectName(project({}), '')).toBe('nodeterm')
  })

  it('applies to an SSH project through its remote cwd', () => {
    const ssh = project({ cwd: undefined, name: 'app', ssh: { remoteCwd: '/srv/app' } as never })
    expect(effectiveProjectName(ssh, 'Production API')).toBe('Production API')
  })

  it('leaves a cwd-less (inline) project alone — there is no folder to compare against', () => {
    expect(effectiveProjectName({ name: 'Scratch' }, 'Whatever')).toBe('Scratch')
  })
})

describe('effectiveProjectColor', () => {
  it('takes the icon’s accent over the palette colour a project was handed at creation', () => {
    expect(effectiveProjectColor({ color: '#ff9f0a' }, '#2970ff')).toBe('#2970ff')
  })

  it('never overrules a colour someone chose', () => {
    expect(effectiveProjectColor({ color: '#ff9f0a', colorPicked: true }, '#2970ff')).toBe('#ff9f0a')
  })

  it('keeps the project colour when the icon offers none', () => {
    expect(effectiveProjectColor({ color: '#ff9f0a' }, null)).toBe('#ff9f0a')
    expect(effectiveProjectColor({ color: '#ff9f0a' }, undefined)).toBe('#ff9f0a')
  })

  it('reads `colorPicked` strictly — a hand-edited truthy value is not a choice', () => {
    expect(
      effectiveProjectColor({ color: '#ff9f0a', colorPicked: 1 as unknown as boolean }, '#2970ff')
    ).toBe('#2970ff')
  })
})

describe('renderableDerivedIcon', () => {
  it('passes a raster through and sanitizes an SVG into a data URL', () => {
    expect(renderableDerivedIcon({ kind: 'raster', dataUrl: 'data:image/png;base64,AA', from: 'a' }))
      .toEqual({ src: 'data:image/png;base64,AA', from: 'a' })

    const svg = renderableDerivedIcon({
      kind: 'svg',
      svg: '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
      from: '.idea/icon.svg'
    })
    expect(svg?.from).toBe('.idea/icon.svg')
    expect(svg?.src.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(Buffer.from(svg!.src.split(',')[1], 'base64').toString()).not.toContain('script')
  })

  it('answers null for nothing, and for an SVG that sanitizes away', () => {
    expect(renderableDerivedIcon(null)).toBeNull()
    expect(renderableDerivedIcon(undefined)).toBeNull()
    expect(renderableDerivedIcon({ kind: 'svg', svg: 'not markup', from: 'x' })).toBeNull()
  })
})
