import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const packages = resolve(root, 'packages')
const names = ['dsh-knowledge', 'dsh-business-identity', 'dsh-knowledge-gateway', 'dsh-tool-knowledge-read', 'dsh-tool-knowledge-write', 'dsh-tool-knowledge-admin', 'dsh-knowledge-policy', 'dsh-bundle-ragflow-knowledge']
const manifest = (name: string) => JSON.parse(readFileSync(resolve(packages, name, 'package.json'), 'utf8'))

describe('knowledge workspace ownership', () => {
  it('contains exactly eight real implementation packages, not forwarding entrypoints', () => {
    expect(readdirSync(packages).sort()).toEqual([...names].sort())
    for (const name of names) {
      const pkg = manifest(name)
      expect(pkg.name).toBe(name)
      expect(pkg.private).toBe(true)
      const entry = readFileSync(resolve(packages, name, pkg.exports['.']), 'utf8')
      expect(entry).toMatch(/export (?:async )?(?:function|class) /u)
      expect(pkg.scripts.typecheck).toBe('tsc --noEmit -p tsconfig.json')
    }
  })

  it('enforces declared one-way dependencies for every TypeScript import', () => {
    for (const name of names) {
      const deps = manifest(name).dependencies
      for (const file of readdirSync(resolve(packages, name)).filter(file => file.endsWith('.ts'))) {
        const path = resolve(packages, name, file)
        const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
        const visit = (node: ts.Node) => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const specifier = node.moduleSpecifier.text
            if (specifier.startsWith('.')) {
              const target = relative(packages, resolve(dirname(path), specifier)).replaceAll('\\', '/').split('/')[0]!
              expect(names, `${name}/${file} escapes package ownership`).toContain(target)
              if (target !== name) expect(deps[target], `${name} -> ${target} is undeclared`).toBe(`file:../${target}`)
            } else {
              expect(specifier.startsWith('node:') || specifier.startsWith('@nomix-ai/nomix-harness/plugin'), `${name}/${file}: ${specifier}`).toBe(true)
            }
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
  })

  it('keeps core provider-neutral, tools Gateway-independent, and the graph acyclic', () => {
    const dependencies = (name: string): string[] => Object.keys(manifest(name).dependencies).filter(dep => names.includes(dep))
    expect(dependencies('dsh-knowledge')).toEqual([])
    for (const role of ['read', 'write', 'admin']) expect(dependencies(`dsh-tool-knowledge-${role}`)).toEqual(['dsh-knowledge'])
    function visit(name: string, chain: string[]) {
      expect(chain, `dependency cycle: ${[...chain, name].join(' -> ')}`).not.toContain(name)
      for (const next of dependencies(name)) visit(next, [...chain, name])
    }
    for (const name of names) visit(name, [])
  })

  it('keeps the public consumer independent from the replaceable Gateway provider', () => {
    for (const file of ['consumer.ts', 'plugin.ts']) {
      const text = readFileSync(resolve(packages, 'dsh-bundle-ragflow-knowledge', file), 'utf8')
      expect(text).not.toContain('dsh-knowledge-gateway')
      expect(text).not.toContain('gatewayBaseURL')
      expect(text).not.toContain('serviceTokenRef')
    }
  })

  it('keeps published code, contracts and configuration independent of a specific business system', () => {
    const files = ['package.json', 'README.md', 'README.zh.md', 'packages/dsh-bundle-ragflow-knowledge/cordis.patch.yml']
    for (const directory of ['src', 'contracts', ...names.map(name => `packages/${name}`)]) {
      for (const file of readdirSync(resolve(root, directory)).filter(file => /\.(?:ts|json|md)$/u.test(file))) files.push(`${directory}/${file}`)
    }
    for (const file of files) expect(readFileSync(resolve(root, file), 'utf8'), file).not.toMatch(/shilimei|视力美|xiaoshi/iu)
    const contract = JSON.parse(readFileSync(resolve(root, 'contracts/knowledge-gateway.openapi.json'), 'utf8'))
    expect(contract['x-nomix-business-rules'].authorizationOwner).toBe('business-knowledge-gateway')
    expect(contract['x-nomix-business-rules'].providerSelectionOwner).toBe('business-knowledge-gateway')
    expect(contract.servers).toBeUndefined()
  })
})
